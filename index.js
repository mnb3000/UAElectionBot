const { JSDOM } = require('jsdom');
const TelegramBot = require('node-telegram-bot-api');

async function getResults() {
  const dom = await JSDOM.fromURL("https://cvk.gov.ua/pls/vp2019/wp300pt001f01=719.html");
  const { document } = dom.window;
  const allTables = document.querySelectorAll('table');
  const firstTableRows = allTables.item(0).rows;
  const processedPercent = parseFloat(firstTableRows.item(0).cells.item(1).textContent.trim());
  const voteCount = parseInt(firstTableRows.item(1).cells.item(1).textContent.trim().replace(' ', ''), 10);
  const invalidPercent = parseFloat(firstTableRows.item(2).cells.item(1).textContent.trim());

  const secondTableRows = allTables.item(1).rows;
  const candidates = [];
  for (let row of secondTableRows) {
    const { cells } = row;
    if (cells.item(0).textContent === 'Кандидат') continue;
    candidates.push({
      name: cells.item(0).textContent,
      percent: parseFloat(cells.item(2).textContent.trim().replace(' ', '')),
      count: parseInt(cells.item(3).textContent.trim().replace(' ', ''), 10),
    });
  }

  return {
    processedPercent,
    voteCount,
    invalidPercent,
    candidates
  }
}

async function formatMessage(candidateCount = 0) {
  const results = await getResults();
  let response = `*${results.processedPercent}%* протоколiв\n*${results.voteCount}* голосiв\n*${results.invalidPercent}%* бюлетеней недiйснi\n\n`;
  results.candidates.slice(0, candidateCount ? candidateCount : undefined).forEach((candidate) => {
    response += `*${candidate.name}* - ${candidate.percent}%  _(${candidate.count} голосiв)_\n`
  });
  return response
}

const bot = new TelegramBot(process.env['BOT_TOKEN'], { polling: true });

bot.onText(/^\/results$/, async (msg) => {
  const response = await formatMessage(5);
  await bot.sendMessage(msg.chat.id, response, { parse_mode: 'Markdown' });
});
bot.onText(/^\/results_all$/, async (msg) => {
  const response = await formatMessage();
  await bot.sendMessage(msg.chat.id, response, { parse_mode: 'Markdown' });
});

bot.onText(/^\/start$/, async (msg) => {
  await bot.sendMessage(msg.chat.id, 'Привiт! Я допомогаю спостерiгати за обробкою результатiв выборiв президента України!\nНатисни /results!');
});
