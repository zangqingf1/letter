'use strict';
/**
 * 统计口径 · 「我的」页（PRD 第八节）
 *
 * 一条硬口径：重读总次数与回信条数只统计「信箱里还在的信件」。
 * 删除进废纸篓的信件仍保留自己的重读记录与回信（取回时原样恢复，见 letter.restore），
 * 但这些记录不能再算进这两个数字 —— 所以 stats 必须按在匣信件 _id 正向过滤，
 * 而不是对记录表全量 count（也正因为不能用「全量 − 废纸篓」的减法，孤儿记录也要挡掉）。
 */
const { suite, test, eq } = require('../runner');
const { createHarness } = require('../harness');

/** 造一封属于 openid 的信，返回 _id */
function seedLetter(h, openid, over) {
  return h.seed('letters', Object.assign({
    _openid: openid,
    name: '信',
    question: 'q',
    answer: 'a',
    status: 'active',
    pinned: false,
    paper_id: 'liubai',
    created_at: new Date()
  }, over || {}))[0];
}

function seedOpen(h, openid, letterId) {
  h.seed('open_records', { _openid: openid, letter_id: letterId, open_date: '2026-09-01', created_at: new Date() });
}

function seedReply(h, openid, letterId) {
  h.seed('reply_records', { _openid: openid, letter_id: letterId, content: 'r', created_at: new Date() });
}

suite('统计口径 · 只算信箱里还在的信件', () => {
  test('ST-01 废纸篓信件的重读与回信不计入「我的」页', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const inBox = seedLetter(h, 'openid-A');
    const trashed = seedLetter(h, 'openid-A', { status: 'recycled', recycled_at: new Date() });
    seedOpen(h, 'openid-A', inBox);
    seedOpen(h, 'openid-A', inBox);
    seedOpen(h, 'openid-A', trashed);
    seedOpen(h, 'openid-A', trashed);
    seedOpen(h, 'openid-A', trashed);
    seedReply(h, 'openid-A', inBox);
    seedReply(h, 'openid-A', trashed);

    const r = await h.load('stats')({ action: 'get' });
    eq(r.letterTotal, 1, '信件总数只算在匣信件');
    eq(r.recycleCount, 1, '废纸篓数量照旧单列');
    eq(r.rereadTotal, 2, '废纸篓里的 3 枚邮戳不得计入');
    eq(r.replyTotal, 1, '废纸篓里的 1 条回信不得计入');
  });

  test('ST-02 删除进废纸篓 → 数字立刻回落，取回后重新计入（记录本身不动）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const id = seedLetter(h, 'openid-A');
    seedOpen(h, 'openid-A', id);
    seedReply(h, 'openid-A', id);
    const stats = h.load('stats');
    const letter = h.load('letter');

    let r = await stats({ action: 'get' });
    eq([r.letterTotal, r.rereadTotal, r.replyTotal], [1, 1, 1], '在匣时正常计入');

    eq((await letter({ action: 'moveToRecycle', id })).ok, true);
    r = await stats({ action: 'get' });
    eq([r.letterTotal, r.rereadTotal, r.replyTotal, r.recycleCount], [0, 0, 0, 1], '进废纸篓后归零');

    eq((await letter({ action: 'restore', id })).ok, true);
    r = await stats({ action: 'get' });
    eq([r.letterTotal, r.rereadTotal, r.replyTotal, r.recycleCount], [1, 1, 1, 0], '取回后原样恢复');
    eq(h.count('open_records'), 1, '取回不重建记录，记录本就没被删过');
  });

  test('ST-03 彻底删除后残留的孤儿记录不计入（正向过滤，不是减法）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    seedLetter(h, 'openid-A');
    seedOpen(h, 'openid-A', 'ghost');
    seedReply(h, 'openid-A', 'ghost');

    const r = await h.load('stats')({ action: 'get' });
    eq(r.letterTotal, 1);
    eq(r.rereadTotal, 0, '指向已不存在信件的记录不得计入');
    eq(r.replyTotal, 0, '指向已不存在信件的记录不得计入');
  });

  test('ST-04 信箱为空时不打记录表查询，六项全为 0', async () => {
    const h = createHarness({ openid: 'openid-A' });
    seedOpen(h, 'openid-A', 'ghost');
    seedReply(h, 'openid-A', 'ghost');

    const r = await h.load('stats')({ action: 'get' });
    eq([r.letterTotal, r.rereadTotal, r.replyTotal], [0, 0, 0]);
    eq(r.ok, true);
  });

  test('ST-05 信件数跨过单页与分片边界仍逐封累加（1001 封在匣信）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    for (let i = 0; i < 1001; i += 1) {
      seedOpen(h, 'openid-A', seedLetter(h, 'openid-A'));
    }
    // 废纸篓里的记录混在同一张表里，且数量恰好落在分片边界上
    seedOpen(h, 'openid-A', seedLetter(h, 'openid-A', { status: 'recycled', recycled_at: new Date() }));

    const r = await h.load('stats')({ action: 'get' });
    eq(r.letterTotal, 1001, '游标翻页不得漏信（单页上限 1000）');
    eq(r.rereadTotal, 1001, '11 个分片累加不得漏算（单分片上限 100）');
  });
});
