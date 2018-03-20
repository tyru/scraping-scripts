
const IMAP_USER_ID = 'gmail user';
const IMAP_PASSWORD = 'gmail password';

module.exports = {
  RAKUTEN_USER_ID: 'rakuten user',
  RAKUTEN_PASSWORD: 'rakuten password',
  RAKUTEN_QUESTIONS: [
    [/出身地は？/, 'ぐんまけん'],
    [/初めて飼ったペットの名前は？/, 'ももこ'],
  ],
  IMAP_SERVER: 'imap.gmail.com',
  IMAP_USER_ID,
  IMAP_PASSWORD,
  IMAP_OPTIONS: {
    secureConnection: true,
    auth: {
      user: IMAP_USER_ID,
      pass: IMAP_PASSWORD,
    },
  },
  OUT_TSV_PATH: './rakuten-bank.tsv',
};
