const { JSDOM } = require('jsdom');
const TelegramBot = require('node-telegram-bot-api');
const Datastore = require('nedb-promises');

async function getResults(resultsDatastore, subsDatastore, bot) {
  const dom = await JSDOM.fromURL("https://www.cvk.gov.ua/pls/vp2019/wp300pt001f01=720.html");
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
      name: cells.item(0).textContent.replace(/([А-Я])/g, ' $1').trim(),
      percent: parseFloat(cells.item(2).textContent.trim().replace(/ /g, '')),
      count: parseInt(cells.item(3).textContent.trim().replace(/ /g, ''), 10),
    });
  }

  const result = {
    processedPercent,
    voteCount,
    invalidPercent,
    candidates
  };

  const foundResult = await resultsDatastore.findOne({ processedPercent });

  if (!foundResult) {
    await resultsDatastore.insert(result);
    const subs = await subsDatastore.find();
    if (subs.length) {
      const promiseArr = [];
      const response = formatMessage(result, 2);
      subs.forEach((sub) => {
        promiseArr.push(bot.sendMessage(sub.tgId, response, { parse_mode: 'Markdown' }))
      });
      await Promise.all(promiseArr);
    }
  }

  return result;
}

async function getCachedResult(resultsDatastore, subsDatastore, bot) {
  const cachedResults = await resultsDatastore.find().sort({ createdAt: 1 });
  const cachedResult = cachedResults[0];
  if (cachedResult) {
    return cachedResult
  } else {
    const result = await getResults(resultsDatastore, subsDatastore, bot);
    return result;
  }
}

function formatMessage(result, candidateCount = 0) {
  let response = `*${result.processedPercent}%* протоколiв\n*${result.voteCount}* голосiв\n*${result.invalidPercent}%* бюлетеней недiйснi\n\n`;
  result.candidates.slice(0, candidateCount ? candidateCount : undefined).forEach((candidate) => {
    response += `*${candidate.name}* - ${candidate.percent}%  _(${candidate.count} голосiв)_\n`
  });
  return response
}

async function main() {
  const bot = new TelegramBot(process.env['BOT_TOKEN'], { polling: true });
  const resultsDatastore = Datastore.create({ filename: './results.db', timestampData: true });
  const subsDatastore = Datastore.create({ filename: './subs.db' });

  bot.onText(/^\/results(?:[A-Za-z@\d]*)?$/, async (msg) => {
    const result = await getCachedResult(resultsDatastore, subsDatastore, bot);
    const response = formatMessage(result, 2);
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

  await getResults(resultsDatastore, subsDatastore, bot);
  setTimeout(function run() {
    getResults(resultsDatastore, subsDatastore, bot);
    setTimeout(run, 30000);
  }, 30000);
}

main()
  .catch((e) => console.log(e));
