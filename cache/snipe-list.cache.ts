import fs from 'fs';
import path from 'path';
import { logger, SNIPE_LIST_REFRESH_INTERVAL } from '../helpers';

export class SnipeListCache {
  private snipeList: string[] = [];
  private fileLocation = path.join(__dirname, '../snipe-list.txt');

  constructor() {
    setInterval(() => this.loadSnipeList(), SNIPE_LIST_REFRESH_INTERVAL);
  }

  public init() {
    this.loadSnipeList();
  }

  public isInList(mint: string) {
    return this.snipeList.includes(mint);
  }

  public addToList(mint: string) {
    if (!this.snipeList.includes(mint)) {
      this.snipeList.push(mint);
      logger.info(`Added ${mint} to snipe list: ${this.snipeList}`);
      const data = fs.readFileSync(this.fileLocation, 'utf-8');
      fs.writeFileSync(this.fileLocation, this.snipeList.join('\n'));
    }
  }

  public removeFromList(mint: string) {
    const index = this.snipeList.indexOf(mint);
    if (index > -1) {
      this.snipeList.splice(index, 1);
    }
  }

  private loadSnipeList() {
    logger.trace(`Refreshing snipe list...`);

    const count = this.snipeList.length;
    const data = fs.readFileSync(this.fileLocation, 'utf-8');
    this.snipeList = data
      .split('\n')
      .map((a) => a.trim())
      .filter((a) => a);

    if (this.snipeList.length != count) {
      logger.info(`Loaded snipe list: ${this.snipeList.length}`);
    }
  }
}
