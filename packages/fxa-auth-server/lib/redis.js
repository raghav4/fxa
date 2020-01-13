/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

'use strict';

const Redis = require('ioredis');
const { readdirSync, readFileSync } = require('fs');
const { basename, extname, resolve } = require('path');

const scriptNames = readdirSync(resolve(__dirname, 'luaScripts'), {
  withFileTypes: true,
})
  .filter(de => de.isFile() && extname(de.name) === '.lua')
  .map(de => basename(de.name, '.lua'));

function readScript(name) {
  return readFileSync(resolve(__dirname, 'luaScripts', `${name}.lua`), {
    encoding: 'utf8',
  });
}

function resolveInMs(ms, value) {
  return new Promise(resolve => setTimeout(() => resolve(value), ms));
}

function rejectInMs(ms, err = new Error('redis timeout')) {
  return new Promise((_, reject) => setTimeout(() => reject(err), ms));
}

class FxaRedis {
  constructor(config, log) {
    config.keyPrefix = config.prefix;
    this.log = log;
    this.redis = new Redis(config);
    this.timeoutMs = config.timeoutMs || 1000;
    scriptNames.forEach(name => this.defineCommand(name));
  }

  defineCommand(scriptName) {
    const [name, numberOfKeys] = scriptName.split('_');
    this.redis.defineCommand(name, {
      lua: readScript(scriptName),
      numberOfKeys: +numberOfKeys,
    });
  }

  touchSessionToken(uid, token) {
    return Promise.race([
      this.redis.touchSessionToken(uid, JSON.stringify(token)),
      resolveInMs(this.timeoutMs),
    ]);
  }

  pruneSessionTokens(uid, tokenIds = []) {
    return Promise.race([
      this.redis.pruneSessionTokens(uid, JSON.stringify(tokenIds)),
      rejectInMs(this.timeoutMs),
    ]);
  }

  async getSessionTokens(uid) {
    try {
      const value = await Promise.race([
        this.redis.getSessionTokens(uid),
        rejectInMs(this.timeoutMs),
      ]);
      return JSON.parse(value);
    } catch (e) {
      this.log.error('redis', e);
      return {};
    }
  }

  close() {
    return this.redis.quit();
  }

  del(key) {
    return this.redis.del(key);
  }

  get(key) {
    return this.redis.get(key);
  }

  set(key, val) {
    return this.redis.set(key, val);
  }
  zadd(key, ...args) {
    return this.redis.zadd(key, ...args);
  }
  zrange(key, start, stop, withScores) {
    if (withScores) {
      return this.redis.zrange(key, start, stop, 'WITHSCORES');
    }
    return this.redis.zrange(key, start, stop);
  }
  zrangebyscore(key, min, max) {
    return this.redis.zrangebyscore(key, min, max);
  }
  zrem(key, ...members) {
    return this.redis.zrem(key, members);
  }
  zrevrange(key, start, stop) {
    return this.redis.zrevrange(key, start, stop);
  }
  zrevrangebyscore(key, min, max) {
    return this.redis.zrevrangebyscore(key, min, max);
  }

  async zpoprangebyscore(key, min, max) {
    const args = Array.from(arguments);
    const results = await this.redis
      .multi()
      .zrangebyscore(...args)
      .zremrangebyscore(key, min, max)
      .exec();
    return results[0][1];
  }
}

module.exports = (config, log) => {
  if (!config.enabled) {
    return;
  }
  return new FxaRedis(config, log);
};
