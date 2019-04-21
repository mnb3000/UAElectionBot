const { JSDOM } = require('jsdom');
const TelegramBot = require('node-telegram-bot-api');
const Datastore = require('nedb-promises');

async function getResults(resultsDatastore, subsDatastore, bot) {
  const dom = await JSDOM.fromURL("https://cvk.gov.ua/pls/vp2019/wp300pt001f01=719.html");
  const { document } = dom.window;
  const allTables = document.querySelectorAll('table');
  const firstTableRows = allTables.item(0).rows;
  const processedPercent = parseFloat(firstTableRows.item(0).cells.item(1).textContent.trim());
  const voteCount = parseInt(firstTableRows.item(1).cells.item(1).textContent.trim().replace(/ /g, ''), 10);
  const invalidPercent = parseFloat(firstTableRows.item(2).cells.item(1).textContent.trim());

  const secondTableRows = allTables.item(1).rows;
  const candidates = [];
  for (let row of secondTableRows) {
    const { cells } = row;
    if (cells.item(0).textContent === 'Кандидат') continue;
    candidates.push({
      name: cells.item(0).textContent,
      percent: parseFloat(cells.item(2).textContent.trim().replace(/ /g, '')),
      count: parseInt(cells.item(3).textContent.trim().replace(/ /g, ''), 10),
    });
  }

  const foundResult = await resultsDatastore.findOne({ processedPercent });
  console.log(foundResult);

  const result = {
    processedPercent,
    voteCount,
    invalidPercent,
    candidates
  };

  if (!foundResult) {
    await resultsDatastore.insert(result);
    const subs = await subsDatastore.find();
    const promiseArr = [];
    const response = formatMessage(resultsDatastore, subsDatastore, 2);
    subs.forEach((sub) => {
      promiseArr.push(bot.sendMessage(sub.tgId, response, { parse_mode: 'Markdown' }))
    });
    await Promise.all(promiseArr);
  }

  return result;
}

async function formatMessage(resultsDatastore, subsDatastore, bot, candidateCount = 0) {
  const results = await getResults(resultsDatastore, subsDatastore, bot);
  let response = `*${results.processedPercent}%* протоколiв\n*${results.voteCount}* голосiв\n*${results.invalidPercent}%* бюлетеней недiйснi\n\n`;
  results.candidates.slice(0, candidateCount ? candidateCount : undefined).forEach((candidate) => {
    response += `*${candidate.name}* - ${candidate.percent}%  _(${candidate.count} голосiв)_\n`
  });
  return response
}

async function main() {
  const bot = new TelegramBot(process.env['BOT_TOKEN'], { polling: true });
  const resultsDatastore = Datastore.create({ filename: './results.db', timestampData: true });
  const subsDatastore = Datastore.create({ filename: './subs.db' });

  bot.onText(/^\/results(?:[A-Za-z@\d]*)?$/, async (msg) => {
    const response = await formatMessage(resultsDatastore, subsDatastore, bot, 2);
    await bot.sendMessage(msg.chat.id, response, { parse_mode: 'Markdown' });
  });
  // bot.onText(/^\/results_all/, async (msg) => {
  //   const response = await formatMessage();
  //   await bot.sendMessage(msg.chat.id, response, { parse_mode: 'Markdown' });
  // });

  bot.onText(/^\/start(?:[A-Za-z@\d]*)?$/, async (msg) => {
    await bot.sendMessage(msg.chat.id,
      '*Привiт! Я допомогаю спостерiгати за обробкою результатiв выборiв президента України!*\nНатисни /results або /subscribe!\n\n_Розробник:_ @mnb3000\n_Код:_ https://github.com/mnb3000/UAElectionBot',
      { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/subscribe(?:[A-Za-z@\d]*)?$/, async (msg) => {
    const chatId = msg.chat.id;
    if (msg.chat.type !== 'private') {
      await bot.sendMessage(chatId, 'Пiдписка на результати можлива лише у особистих повiдомленнях!');
      return;
    }
    await subsDatastore.insert({ tgId: chatId, username: msg.from.username });
    await bot.sendMessage(chatId, 'Ти успiшно пiдписався на змiни у результатах!');
  });

  bot.onText(/^\/unsubscribe(?:[A-Za-z@\d]*)?$/, async (msg) => {
    const chatId = msg.chat.id;
    if (msg.chat.type !== 'private') {
      await bot.sendMessage(chatId, 'Пiдписка на результати можлива лише у особистих повiдомленнях!');
      return;
    }
    await subsDatastore.remove({ tgId: chatId });
    await bot.sendMessage(chatId, 'Ти успiшно вiдписався вiд змiн у результатах!');
  });

  setTimeout(function run() {
    getResults(resultsDatastore);
    setTimeout(run, 60000);
  }, 60000);
}

main()
  .catch((e) => console.log(e));
