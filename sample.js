
// 参考元ページ
// http://tech.vasily.jp/entry/puppeteer

const fs = require('fs');
const puppeteer = require('puppeteer');
const inbox = require('inbox');
const iconv = require('iconv');
const converter = new iconv.Iconv("ISO-2022-JP", "UTF-8");

const config = require('./config.js');

// process.on('unhandledRejection', console.dir);

puppeteer.launch({
  headless: false,
  // slowMo: 300      // 何が起こっているかを分かりやすくするため遅延
}).then(async browser => main(browser).catch(err => {
  console.error(err);
  browser.close();
}).then(() => {
  browser.close();
}));

async function main(browser) {
  const page = await browser.newPage();

  await page.setViewport({ width: 1200, height: 800 }); // view portの指定

  // IMAPサーバにログインしてワンタイムキー通知メールを取得できるようイベント監視
  const { gotOTKey, loggedIn } = loginMailbox(config.IMAP_SERVER, config.IMAP_OPTIONS);

  // ログイン
  await page.goto('https://fes.rakuten-bank.co.jp/MS/main/RbS?CurrentPageID=START&&COMMAND=LOGIN');
  await page.waitForSelector('.user_id');
  await page.type('.user_id', config.RAKUTEN_USER_ID);
  await page.type('.login_password', config.RAKUTEN_PASSWORD);
  await doClick(page, '[value="ログイン"]');

  // ワンタイムキーを発行してメールを受け取るまで待つ
  await loggedIn;
  await doClick(page, '[src="/rb/fes/img/common/btn_onetime.gif"]');
  const otKey = await gotOTKey;

  // ワンタイムキーを入力してログインする
  await page.type('.security_code', otKey);
  await doClick(page, '[value="一時解除実行"]');

  // 本人確認ページかお知らせページかトップページに移動する

  // 本人確認ページに来た場合
  const hasConfirmationText = await page.$$eval(
    'div', elems => [...elems].find(
      el => /ご本人確認のため、以下の認証情報を入力してください。/.test(el.textContent)
    ) !== undefined
  );
  if (hasConfirmationText) {
    console.log('本人確認ページ - 合言葉を入力');
    // 質問を取得
    const question = await page.$eval(
      '#INPUT_FORM > table.margintop20 > tbody > tr:nth-child(2) > td > table > tbody > tr:nth-child(1) > td > div',
      el => el.textContent
    );
    if (question === undefined) {
      throw new Error('質問を取得できなかった');
    }
    // 合言葉を取得
    const answer = config.RAKUTEN_QUESTIONS.find(q => q[0].test(question));
    if (!answer) {
      throw new Error('合言葉を取得できなかった');
    }
    // 合言葉を入力
    await page.type('#INPUT_FORM > table.margintop20 > tbody > tr:nth-child(2) > td > table > tbody > tr:nth-child(2) > td > div > input', answer[1]);
    await doClick(page, '[value="次 へ"]');
  }

  // お知らせページかトップページへの移動を待つ
  await page.waitFor(2000);

  // お知らせページ (pageNumber=IQ0403) に来た場合
  // await page.waitForSelector('input[value="　次へ （MyAccount）　"]');
  const nextButton = await page.$('input[value="　次へ （MyAccount）　"]');
  if (nextButton) {
    console.log('お知らせページ - 次へボタンをクリック');
    // トップページ (pageNumber=IQ0390) に移動
    await Promise.all([
      page.waitForNavigation(),
      nextButton.click(),
    ]);
    await nextButton.dispose();
  }

  // トップページへの移動を待つ
  await page.waitFor(2000);

  // 入出金明細のリンクの URL を取得
  const detailURL = await page.$$eval(
    'a', links => {
      const el = [...links].find(el => /入出金明細/.test(el.textContent));
      return el ? el.href : null;
    }
  );
  if (!detailURL) {
    throw new Error('入出金明細のリンクが見つからなかった');
  }
  // 先月の明細ページに移動
  await Promise.all([
    page.waitForNavigation(),
    page.goto(detailURL),
  ]);

  console.log('start writing details...');
  // 明細をファイルに書き出す
  // 「最新の入出金明細（最大50件・24ヶ月以内）」
  const rows = await page.$$eval(
    'body > center:nth-child(4) > table > tbody > tr > td > table > tbody > tr > td > div.innerbox00 > table tr',
    trList => [...trList].map(tr =>
      [...tr.querySelectorAll('td')].map(td => td.textContent)
    )
  );

  // tab separated values
  // 年月日、説明、支出、残高
  const content =
    rows.filter(cols => cols.length === 4)
    .map(cols => cols.map(col => col.trim().replace(/[\t\n]/g, ' ')).join('\t'))
    .join("\n");

  fs.writeFileSync(config.OUT_TSV_PATH, content);
  console.log('written: ' + config.OUT_TSV_PATH);
}

function defer() {
  const deferred = {};
  deferred.promise = new Promise(
    (resolve, reject) => Object.assign(deferred, { resolve, reject })
  );
  return deferred;
}

function loginMailbox(imapServer, imapOptions) {
  const otKey = defer();
  const login = defer();

  const imap = inbox.createConnection(
    false, imapServer, imapOptions
  );

  imap.on('connect', function() {
    console.log('connected');
    imap.openMailbox('INBOX', function(error) {
      error ? login.reject(error) : login.resolve();
    });
  });

  imap.on('new', function(message) {
    if (message.from.address !== 'service@ac.rakuten-bank.co.jp') {
      console.log('this message is not from rakuten bank. skip.');
      console.log(message.title);
      console.log(message.from.address);
      return;
    }
    let body = '';
    const stream = imap.createMessageStream(message.UID);
    stream.on("data", function(chunk) {
      body += chunk;
    });
    stream.on("end", function() {
      body = converter.convert(body).toString();
      // FIXME: body にはヘッダ部も含まれているため RFC822 に則ってちゃんとパースする？
      if (/ワンタイムキー[ 　]*[:：][ 　]*([a-zA-Z0-9]+)/.test(body)) {
        const key = RegExp.$1;
        console.log('ワンタイムキーを本文から取得成功:' + key);
        otKey.resolve(key);
        imap.close();
      } else {
        console.log('ワンタイムキーを本文から取得失敗');
        otKey.reject();
      }
    });
  });

  imap.connect();

  return {
    gotOTKey: otKey.promise,
    loggedIn: login.promise
  };
}

async function doClick(page, selector) {
  await page.waitForSelector(selector);
  await Promise.all([
    page.waitForNavigation(),
    page.click(selector),
  ]);
}
