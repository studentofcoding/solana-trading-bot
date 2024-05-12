import fs from 'fs';
import path from 'path';
import { logger, BLACK_LIST_REFRESH_INTERVAL } from '../helpers';

export class BlackListCache {
  private blacklist: string[] = [];
  private blacklistFileLocation = path.join(__dirname, '../blacklist.txt');

  constructor() {
    setInterval(() => this.loadBlacklist(), BLACK_LIST_REFRESH_INTERVAL);
  }

  public init() {
    this.loadBlacklist();
  }

  public isBlacklisted(mint: string) {
    return this.blacklist.includes(mint);
  }

  private loadBlacklist() {
    logger.trace(`Loading blacklist...`);

    const count = this.blacklist.length;
    const data = fs.readFileSync(this.blacklistFileLocation, 'utf-8');
    this.blacklist = data
      .split('\n')
      .map((a) => a.trim())
      .filter((a) => a);

    if (this.blacklist.length != count) {
      logger.info(`Loaded blacklist: ${this.blacklist.length}`);
    }
  }
}