// 信纸展示数据构建器（三端共享：step2 预览 / detail 阅读 / share 分享图同源）。
// 共享模板 styles/paper.wxml 只认本文件产出的 view 字段；
// 分享 Canvas（share.js）也用同一批派生值（stampText/dotDate/serial…）绘制装饰，
// 保证「同一封信在三个画面渲染完全相同」。
// dateText（落款长日期）由页面组装后传入：新建信 = 今天，已存信 = created_at，
// 编辑态 = 「写于 · 改于」双落款在后缀中体现，三端口径一致。

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

// 2026年8月30日
function longDate(d) {
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

// 8.30（草写短日期）
function mdDate(d) {
  return (d.getMonth() + 1) + '.' + d.getDate();
}

// 08.30（票面/邮戳等宽短日期）
function stampDate(d) {
  return pad2(d.getMonth() + 1) + '.' + pad2(d.getDate());
}

// digits：20260830（编号/图纸号用）
function digitsOf(d) {
  return '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
}

// view：共享模板渲染一封信所需的全部字段
// letter: { name, question, answer }；options.created 落款基准时间（缺省今天）；
// options.dateText 覆盖落款长日期（编辑态双落款由页面拼好后传入）
function buildView(letter, options) {
  const opts = options || {};
  const created = opts.created ? new Date(opts.created) : new Date();
  const answer = String((letter && letter.answer) || '');
  const digits = digitsOf(created);
  return {
    name: String((letter && letter.name) || ''),
    question: String((letter && letter.question) || ''),
    answer: answer,
    // 号外头版首字下沉：拆出答案首字，余文另起排版
    dropChar: answer.slice(0, 1),
    answerRest: answer.slice(1),
    // 存根票根竖排小字（逐字渲染，避免 writing-mode 兼容性问题）
    stubChars: '凭此信·随时重读'.split(''),
    yearText: String(created.getFullYear()),
    stampText: stampDate(created),
    dotDate: created.getFullYear() + '.' + stampDate(created),
    serial: 'NO.' + digits,
    serialNo: digits,
    dwgNo: created.getFullYear() + '-' + stampDate(created).replace('.', ''),
    dateLong: opts.dateText || longDate(created)
  };
}

module.exports = { buildView, longDate, mdDate, stampDate, digitsOf, pad2 };
