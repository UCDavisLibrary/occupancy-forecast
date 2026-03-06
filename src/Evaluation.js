import { existsSync, readFileSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import libcal from './libcal.js';
import utils from './utils.js';
import Library from './Library.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default class Evaluation {

  constructor(options){

    const requiredOptions = [
      'profilePath', 'startDate', 'endDate', 'libcalLocationId'
    ];
    for ( const option of requiredOptions ){
      if ( options[option] === undefined ){
        throw new Error(`Missing required option: ${option}`);
      }
    }
    this.options = options;

    this.cacheDir = path.join(__dirname, '../data/cache');
    this.data = [];
  }

  async evaluate(){
    await this.readProfiles();
    await this.getHours();
    this.library = new Library(this.profileConfig);
    await this.library.getChunkOccupancyData(this.options.startDate, this.options.endDate);
    this.library.parseData();
    this.constructData();
  }

  async readProfiles(){
    const contents = JSON.parse(readFileSync(this.options.profilePath, 'utf-8'));
    this.profiles = contents.profiles;
    this.profileConfig = contents.config;
    utils.prettyPrint(this.profileConfig);
  }

  async getHours(){
    const cacheFileName = `hours_${this.options.libcalLocationId}_${this.options.startDate}_${this.options.endDate}.json`;
    const cacheFilePath = path.join(this.cacheDir, cacheFileName);
    let data;
    if ( existsSync(cacheFilePath) ){
      console.log(`Loading hours data from cache: ${cacheFileName}`);
      data = JSON.parse(readFileSync(cacheFilePath, 'utf-8'));
    } else {
      data = await libcal.getHours(this.options.libcalLocationId, this.options.startDate, this.options.endDate);
      await mkdir(this.cacheDir, { recursive: true });
      await writeFile(cacheFilePath, JSON.stringify(data), 'utf-8');
    }

    this.hours = data[0].dates;
    for ( const d of Object.values(this.hours) ){
      for ( const range of d.hours || [] ){
        range.open = utils.to24HourTime(range.from);
        range.close = utils.to24HourTime(range.to);
      }
    }
    // utils.prettyPrint(this.hours);
  }

  async constructData(){
    const data = [];
    for ( const [day, status] of Object.entries(this.hours) ){
      const d = {
        dateString: day,
        weekday: utils.getWeekdayShort(day),
        nextDateString: utils.nextDay(day),
        status: status.status, 
        hours: (status.hours || []).map(h => { return {...h}}),
        occupancy: []
      };
      if ( d.status === 'open' ){
        for ( const range of d.hours ){
          const periods = utils.expandRange(range.open, range.close);
          let scheduleType = 'normal';
          if ( Math.round(periods.length / 2) >= this.profileConfig.expandedThreshold ){
            scheduleType = 'expanded';
          } else if ( utils.isSummerQuarter(day) ){
            scheduleType = 'summer';
          } else if ( Math.round(periods.length / 2) <= this.profileConfig.reducedThreshold ){
            scheduleType = 'reduced';
          }
          d.scheduleType = scheduleType;
          let periodsFromOpen = 0;
          let periodsToClose = periods.length - 1;
          for( const period of periods ){
            period.periodsFromOpen = periodsFromOpen;
            period.periodsToClose = periodsToClose;
            const [hour, minute] = period.time.split(':');

            const occupancy = this.library.data.find(r =>
              r.localDate.hour === hour &&
              r.localDate.minute === minute &&
              (period.isNextDay ? r.localDate.date === d.nextDateString : r.localDate.date === d.dateString)
            )?.relativeOccupancy || null;

            period.occupancy = occupancy;

            periodsFromOpen++;
            periodsToClose--;

            d.occupancy.push(period);
          }

        }
        data.push(d);
      }
    }
    this.data = data;
    //this.data = data.filter(d => d.occupancy.every(p => p.occupancy !== null));
    utils.prettyPrint(this.data.slice(-2));
  }

}