import fs from 'fs';
import util from 'util';

const writeFile = util.promisify(fs.writeFile);

export default class Store {
  constructor(file) {
    this.file = file;
    try {
      const filecont = fs.readFileSync(file).toString('utf-8');
      this.store = JSON.parse(filecont);
    } catch(e) {
      // TODO: properly handles EPERM etc
      this.store = {};
    }
  }

  get(gid) {
    return this.store[gid] ?? [];
  }

  list() {
    return Object.keys(this.store).filter(id => this.store[id].length > 0);
  }

  async add(gid, filter) {
    const filters = this.store[gid] ?? [];
    const exists = filters.includes(filter);

    if(!exists) {
      this.store[gid] = [...filters, filter];
      await this.sync();
      return true;
    } else {
      return false;
    }
  }

  async drop(gid, filter) {
    const filters = this.store[gid] ?? [];
    const exists = filters.includes(filter);

    if(exists) {
      this.store[gid] = filters.filter(e => e !== filter);
      await this.sync();
      return true;
    } else {
      return false;
    }
  }

  async sync() {
    await writeFile(this.file, JSON.stringify(this.store), 'UTF-8');
  }
}
