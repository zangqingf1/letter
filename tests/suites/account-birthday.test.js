'use strict';
/**
 * 生日资料（账号页）：为后续「生日来信」做的采集口径。
 * 只收「MM-DD」月日、不收出生年份；月日合法性、清除语义、非法值丢弃都在 user 云函数侧兜底。
 */
const { suite, test, eq } = require('../runner');
const { createHarness } = require('../harness');

suite('生日资料 · user.saveProfile/getProfile', () => {
  test('合法月日写入并回读（MM-DD 原样存储）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('user');
    await main({ action: 'saveProfile', profile: { birthday: '06-15' } });
    eq(h.all('users')[0].birthday, '06-15');
    const r = await main({ action: 'getProfile' });
    eq(r.profile.birthday, '06-15');
  });

  test('不收出生年份与其他形态（只认 MM-DD）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('user');
    await main({ action: 'saveProfile', profile: { birthday: '2005-06-15' } });
    eq(h.all('users')[0].birthday, undefined, '带年份的形态必须丢弃');
    await main({ action: 'saveProfile', profile: { birthday: '6月15日' } });
    eq(h.all('users')[0].birthday, undefined);
    await main({ action: 'saveProfile', profile: { birthday: { m: 6, d: 15 } } });
    eq(h.all('users')[0].birthday, undefined, '非字符串不得落库');
  });

  test('月日越界丢弃：13 月、0 月、0 日、小月 31 日都不行', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('user');
    for (const bad of ['13-01', '00-10', '06-00', '06-31', '04-31', '02-30']) {
      await main({ action: 'saveProfile', profile: { birthday: bad } });
      eq(h.all('users')[0].birthday, undefined, bad + ' 应被丢弃');
    }
  });

  test('二月恒按 29 天：02-29 允许（闰日出生不挡）', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('user');
    await main({ action: 'saveProfile', profile: { birthday: '02-29' } });
    eq(h.all('users')[0].birthday, '02-29');
  });

  test('空串=清除生日；未传 birthday 时保留原值', async () => {
    const h = createHarness({ openid: 'openid-A' });
    const main = h.load('user');
    await main({ action: 'saveProfile', profile: { birthday: '06-15' } });
    await main({ action: 'saveProfile', profile: { nickname: '阿远' } });
    eq(h.all('users')[0].birthday, '06-15', '未传 birthday 不得清掉已有值');
    await main({ action: 'saveProfile', profile: { birthday: '' } });
    eq(h.all('users')[0].birthday, '', '空串表示清除');
  });

  test('getProfile 对没设过生日的账号返回空串', async () => {
    const h = createHarness({ openid: 'openid-A' });
    h.seed('users', { _openid: 'openid-A', nickname: '阿远', status: 'active', created_at: new Date() });
    const main = h.load('user');
    const r = await main({ action: 'getProfile' });
    eq(r.profile.birthday, '');
  });
});
