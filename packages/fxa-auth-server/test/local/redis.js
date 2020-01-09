/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';

const { assert } = require('chai');
const sinon = require('sinon');
const config = require('../../config').getProperties();
const redis = require('../../lib/redis')(
  { ...config.redis, ...config.redis.sessionTokens },
  { error: sinon.spy() }
);

const uid = 'uid1';
const sessionToken = {
  lastAccessTime: 1573067619720,
  location: {
    city: null,
    state: null,
    stateCode: null,
    country: null,
    countryCode: null,
  },
  uaBrowser: 'Firefox',
  uaBrowserVersion: '70.0',
  uaDeviceType: null,
  uaOS: 'Mac OS X',
  uaOSVersion: '10.14',
  id: 'token1',
};

describe('Redis', () => {
  after(async () => {
    await redis.del(uid);
    redis.close();
  });

  describe('touchSessionToken', () => {
    beforeEach(async () => {
      await redis.del(uid);
    });

    it('creates an entry for uid when none exists', async () => {
      const x = await redis.get(uid);
      assert.isNull(x);
      await redis.touchSessionToken(uid, sessionToken);
      const rawData = await redis.get(uid);
      assert.ok(rawData);
    });

    it('appends a new token to an existing uid record', async () => {
      await redis.touchSessionToken(uid, sessionToken);
      await redis.touchSessionToken(uid, { ...sessionToken, id: 'token2' });
      const tokens = await redis.getSessionTokens(uid);
      assert.deepEqual(Object.keys(tokens), [sessionToken.id, 'token2']);
    });

    it('updates existing tokens with new data', async () => {
      await redis.touchSessionToken(uid, { ...sessionToken, uaOS: 'Windows' });
      const tokens = await redis.getSessionTokens(uid);
      assert.equal(tokens[sessionToken.id].uaOS, 'Windows');
    });
  });

  describe('getSessionTokens', () => {
    beforeEach(async () => {
      await redis.del(uid);
      await redis.touchSessionToken(uid, sessionToken);
    });

    it('returns an empty object for unknown uids', async () => {
      const tokens = await redis.getSessionTokens('x');
      assert.isEmpty(tokens);
    });

    it('returns tokens indexed by id', async () => {
      const tokens = await redis.getSessionTokens(uid);
      assert.deepEqual(Object.keys(tokens), [sessionToken.id]);
      // token 'id' not included
      const s = { ...sessionToken };
      delete s.id;
      assert.deepEqual(tokens[sessionToken.id], s);
    });
  });

  describe('pruneSessionTokens', () => {
    beforeEach(async () => {
      await redis.del(uid);
      await redis.touchSessionToken(uid, sessionToken);
      await redis.touchSessionToken(uid, { ...sessionToken, id: 'token2' });
    });

    it('does nothing for unknown uids', async () => {
      await redis.pruneSessionTokens('x');
    });

    it('does nothing for unkown token ids', async () => {
      await redis.pruneSessionTokens(uid, ['x', 'y']);
      const tokens = await redis.getSessionTokens(uid);
      assert.deepEqual(Object.keys(tokens), [sessionToken.id, 'token2']);
    });

    it('deletes a given token id', async () => {
      await redis.pruneSessionTokens(uid, ['token2']);
      const tokens = await redis.getSessionTokens(uid);
      assert.deepEqual(Object.keys(tokens), [sessionToken.id]);
    });

    it('deleted the uid record when no tokens remain', async () => {
      await redis.pruneSessionTokens(uid, [sessionToken.id, 'token2']);
      const rawData = await redis.get(uid);
      assert.isNull(rawData);
    });
  });
});
