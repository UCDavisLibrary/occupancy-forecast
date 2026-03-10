import { existsSync, readFileSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { writeToPath } from 'fast-csv';
import path from 'path';
import { fileURLToPath } from 'url';
import libcal from './libcal.js';
import utils from './utils.js';
import Library from './Library.js';
import math from './math.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * @description Class for evaluating the accuracy of occupancy predictions based on historical data and library hours.
 */
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

    if ( !options.startPeriod ){
      this.options.startPeriod = 3; // when to start predicting occupancy for a given day
    }

    if ( !options.minimumSampleSize ){
      this.options.minimumSampleSize = 10; // minimum number of data points required to attempt to predict occupancy for a given day
    }

    this.profileHierarchy = [['weekday', 'scheduleType'], ['weekday'], ['scheduleType']];

    this.cacheDir = path.join(__dirname, '../data/cache');
    this.reportsDir = path.join(__dirname, '../data/reports');

    this.data = [];
  }

  /**
   * @description Main method to run the evaluation process:
   * 1. Read generated profiles from file
   * 2. Retrieve library hours from Libcal API
   * 3. Construct evaluation dataset by matching library hours with occupancy data
   * 4. Predict occupancy for each period based on profile hierarchy and calculate error
   * 5. Calculate T+1 error for each period based on occupancy at start period
   * 6. Export hourly data and summary statistics to CSV files
   * @returns {Promise<void>}
   */
  async evaluate(){
    await this.readProfiles();
    await this.getHours();
    this.library = new Library(this.profileConfig);
    await this.library.getChunkOccupancyData(this.options.startDate, this.options.endDate);
    this.library.parseData();
    this.constructData();
    this.calculateTOneError();
    await this.exportHourlyData();
    await this.exportSummary();
  }

  /**
   * @description Reads the JSON occupancy profiles (created by the 'generate' cli command) and stores them in the instance for use in evaluation.
   */
  async readProfiles(){
    const contents = JSON.parse(readFileSync(this.options.profilePath, 'utf-8'));
    this.profiles = contents.profiles;
    this.profileConfig = contents.config;
    utils.prettyPrint(this.profileConfig);
  }

  /**
   * @description Retrieves library hours from Libcal API for the specified date range and location, with caching to avoid redundant API calls.
   */
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
      await writeFile(cacheFilePath, JSON.stringify(data, null, 2), 'utf-8');
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

  /**
   * @description Merges the library hours data with the occupancy data to construct a dataset for evaluation. 
   * For each day in the specified date range, it identifies the open periods based on the library hours and matches them with the corresponding occupancy data. 
   * It then predicts occupancy for each period based on the profile hierarchy and calculates the error compared to actual occupancy.
   */
  async constructData(){
    let data = [];
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
    data = data.filter(d => d.occupancy.every(p => p.occupancy !== null));

    for ( const day of data ){
      for ( let i = 0; i < day.occupancy.length; i++ ){
        this.predictPeriodOccupancy(day, i);
      }
    }

    this.data = data;
    //utils.prettyPrint(this.data.slice(-2));
  }

  /**
   * @description Predicts occupancy for a specific period based on the profile hierarchy.
   * @param {Object} day - The day object from this.data
   * @param {number} periodIndex - The index of the period for which to predict occupancy
   */
  predictPeriodOccupancy(day, periodIndex){
    const thisPeriod = day.occupancy[periodIndex];
    if ( periodIndex < this.options.startPeriod ){
      thisPeriod.predictedOccupancy = null;
      return;
    }
    let scaleNumerator = 0;
    let scaleDenominator = 0;
    for ( const period of day.occupancy.slice(0, periodIndex) ){
      const profileOccupancy = this.getProfileOccupancy(day, period.periodsFromOpen);
      period.profileOccupancy = profileOccupancy.occupancy;
      period.profile = profileOccupancy.profile;
      if ( !profileOccupancy ){
        console.warn(`No profile found for day ${day.dateString} period ${period.periodsFromOpen} from open, ${period.periodsToClose} to close`);
        continue;
      }
      scaleNumerator += ( period.occupancy * profileOccupancy.occupancy );
      scaleDenominator += ( profileOccupancy.occupancy * profileOccupancy.occupancy );
    }
    const profileOccupancy = this.getProfileOccupancy(day, periodIndex);
    if ( !profileOccupancy ){
      console.warn(`No profile found for day ${day.dateString} period ${this.options.startPeriod} from open, ${this.options.startPeriod} to close`);
      thisPeriod.predictedOccupancy = null;
      return;
    }
    thisPeriod.scale = math.toTwoDecimalPlaces((scaleDenominator ? scaleNumerator / scaleDenominator : 1));
    thisPeriod.predictedOccupancy = math.toTwoDecimalPlaces(thisPeriod.scale * profileOccupancy.occupancy);
    thisPeriod.profile = profileOccupancy.profile;
    thisPeriod.profileOccupancy = profileOccupancy.occupancy;
    if ( thisPeriod.predictedOccupancy ) {
      thisPeriod.error = math.toTwoDecimalPlaces(Math.abs(thisPeriod.predictedOccupancy - thisPeriod.occupancy));
    }
  }

  /**
   * @description Predict occupancy and error for entire day based on the occupancy at the start period
   */
  calculateTOneError(){
    for ( const day of this.data ){
      const tOneScale = day.occupancy?.[this.options.startPeriod]?.scale || 1;
      for ( const period of day.occupancy.slice(this.options.startPeriod) ){
        if ( !period.profileOccupancy ) continue;
        period.tOnePredicted = math.toTwoDecimalPlaces(tOneScale * period.profileOccupancy);
        period.tOneError = math.toTwoDecimalPlaces(Math.abs(period.tOnePredicted - period.occupancy));
      }
    }
  }

  /**
   * @description Get the occupancy value for a given period based on the profile hierarchy.
   * @param {Object} day - The day object from this.data
   * @param {number} periodIndex - The index of the period for which to get occupancy value
   * @returns {Object|null} - The profile occupancy value or null if not found
   */
  getProfileOccupancy(day, periodIndex){
    const period = day.occupancy[periodIndex];

    // find first profile with sufficient sample size
    for ( const profileParts of this.profileHierarchy ){
      const profile = this.profiles.find(p => utils.objectsMatch(p.grouping, utils.subsetObject(day, profileParts)));
      if ( !profile ) {
        console.warn(`No profile found for grouping ${JSON.stringify(utils.subsetObject(day, profileParts))}`);
      }

      // calculate weighted average of medians for this period from open/to close, using count as weight
      const profileOpen = profile.periodsFromOpen.find(p => p.period === period.periodsFromOpen);
      const profileClose = profile.periodsToClose.find(p => p.period === period.periodsToClose);
      const profileMedians = [];
      const profileWeights = [];
      for ( const p of [profileOpen, profileClose] ){
        const ct = p?.count || 0;
        if ( ct >= this.options.minimumSampleSize ){
          profileMedians.push(p.median);
          profileWeights.push(ct);
        }
      }
      if ( !profileMedians.length ) continue;
      return {
        occupancy: math.toTwoDecimalPlaces(math.weightedAverage(profileMedians, profileWeights)),
        profile: profile.grouping
      };
    }
    return null;
  }

  /**
   * @description Exports summary statistics of the evaluation for each day to a CSV file
   */
  async exportSummary(){
    const rows = this.data.map(day => {
      const errors = day.occupancy.map(p => p.error).filter(e => e !== null && e !== undefined);
      const tOneErrors = day.occupancy.map(p => p.tOneError).filter(e => e !== null && e !== undefined);
      return {
        date: day.dateString,
        weekday: day.weekday,
        scheduleType: day.scheduleType,
        open: day.hours?.[0]?.open || null,
        close: day.hours?.[0]?.close || null,
        averageError: errors.length ? math.toTwoDecimalPlaces(math.average(errors)) : null,
        medianError: errors.length ? math.toTwoDecimalPlaces(math.median(errors)) : null,
        maxError: errors.length ? math.toTwoDecimalPlaces(Math.max(...errors)) : null,
        minError: errors.length ? math.toTwoDecimalPlaces(Math.min(...errors)) : null,
        p25Error: errors.length ? math.toTwoDecimalPlaces(math.percentile(errors, 0.25)) : null,
        p75Error: errors.length ? math.toTwoDecimalPlaces(math.percentile(errors, 0.75)) : null,
        averageTOneError: tOneErrors.length ? math.toTwoDecimalPlaces(math.average(tOneErrors)) : null,
        medianTOneError: tOneErrors.length ? math.toTwoDecimalPlaces(math.median(tOneErrors)) : null,
        maxTOneError: tOneErrors.length ? math.toTwoDecimalPlaces(Math.max(...tOneErrors)) : null,
        minTOneError: tOneErrors.length ? math.toTwoDecimalPlaces(Math.min(...tOneErrors)) : null,
        p25TOneError: tOneErrors.length ? math.toTwoDecimalPlaces(math.percentile(tOneErrors, 0.25)) : null,
        p75TOneError: tOneErrors.length ? math.toTwoDecimalPlaces(math.percentile(tOneErrors, 0.75)) : null
      };
    });
    const dir = path.join(this.reportsDir, 'summary', `${this.options.libcalLocationId}`);
    await mkdir(dir, { recursive: true });
    const filepath = `${dir}/${this.options.startDate}_${this.options.endDate}.csv`;
    await writeToPath(filepath, rows, { headers: true });
  }

  /**
   * @description Exports the hourly evaluation data for each period to a CSV file.
   */
  async exportHourlyData(){
    const rows = [];
    for ( const day of this.data ){
      for ( const period of day.occupancy ){
        rows.push({
          date: day.dateString,
          weekday: day.weekday,
          scheduleType: day.scheduleType,
          open: day.hours?.[0]?.open || null,
          close: day.hours?.[0]?.close || null,
          time: period.time,
          occupancy: period.occupancy,
          predictedOccupancy: period.predictedOccupancy,
          profile: JSON.stringify(period.profile),
          error: period.error,
          scale: period.scale,
          tOneError: period.tOneError,
          tOnePredicted: period.tOnePredicted,
          profileOccupancy: period.profileOccupancy
        });
      }
    }
    const dir = path.join(this.reportsDir, 'hourly', `${this.options.libcalLocationId}`);
    await mkdir(dir, { recursive: true });
    const filepath = `${dir}/${this.options.startDate}_${this.options.endDate}.csv`;
    await writeToPath(filepath, rows, { headers: true });
  }

}