import { mkdir, writeFile } from 'fs/promises';
import { writeToPath } from 'fast-csv';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import math from './math.js';
import path from 'path';

import sensource from "./sensource.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * @description Class for generating same-day occupancy profiles for a library based on historical data.
 */
export default class Library {

  constructor(options){
    
    const requiredOptions = [
      'space', 'startDate', 'openThreshold', 'closeThreshold', 'capacity'
    ];
    for ( const option of requiredOptions ){
      if ( options[option] === undefined ){
        throw new Error(`Missing required option: ${option}`);
      }
    }

    this.options = {
      space: options.space,
      startDate: options.startDate,
      openThreshold: parseInt(options.openThreshold),
      closeThreshold: parseInt(options.closeThreshold),
      capacity: parseInt(options.capacity),
      reducedThreshold: options.reducedThreshold ? parseInt(options.reducedThreshold) : null,
      expandedThreshold: options.expandedThreshold ? parseInt(options.expandedThreshold) : null
    }
    
    this.data = [];
    this.hours = [];

    this.profileGroupings = ['weekday', 'scheduleType'];

    this.cacheDir = path.join(__dirname, '../data/cache');
    this.reportsDir = path.join(__dirname, '../data/reports');
    this.profilesDir = path.join(__dirname, '../data/profiles');
  }

  /**
   * @description Main method to run the profile generation process:
   * 1. Retrieve occupancy data from Sensource API (with caching)
   * 2. Parse and preprocess the data (filter errors, calculate relative occupancy, etc.)
   * 3. Estimate open/close times for each day based on entry/exit thresholds
   * 4. Generate occupancy profiles based on configured groupings and save to file
   */
  async generate(){
    await this.getOccupancyData();

    const output = {
      config: this.options,
      profiles: []
    }

    const data = this.data.filter(d => d.isOpen);
    const uniqueValues = {};
    for ( const grouping of this.profileGroupings ){
      uniqueValues[grouping] = [...new Set(data.map(d => d[grouping]))].filter(v => v !== null && v !== undefined);
    }
    const profileGroupings = math.combinations(this.profileGroupings);
    for ( const grouping of profileGroupings ){
      const uniqueCombos = math.cartesianProductObjects(
        grouping.reduce((acc, key) => {
          if (key in uniqueValues) {
            acc[key] = uniqueValues[key];
          }
          return acc;
        }, {})
      );
      for ( const combo of uniqueCombos ){
        const profileData = data.filter(d => {
          for ( const key in combo ){
            if ( d[key] !== combo[key] ) return false;
          }
          return true;
        });
        const profile = {
          grouping: combo,
          periodsFromOpen: [],
          periodsToClose: []
        }

        for ( const row of profileData ){
          for ( const metric of ['periodsFromOpen', 'periodsToClose'] ){
            if ( row[metric] !== null && row[metric] !== undefined ){
              let d = profile[metric].find(d => d.period === row[metric]);
              if ( !d ){
                d = {
                  period: row[metric],
                  relativeOccupancy: []
                }
                profile[metric].push(d);
              }
              d.relativeOccupancy.push(row.relativeOccupancy);
            }
          }
        }

        for ( const metric of ['periodsFromOpen', 'periodsToClose'] ){
          profile[metric] = profile[metric].map(d => {
            d.relativeOccupancy.sort((a, b) => a - b);

            d.median = math.median(d.relativeOccupancy, true);
            d.count = d.relativeOccupancy.length;
            d.percentiles = {
              p10: math.percentile(d.relativeOccupancy, 0.1, true),
              p25: math.percentile(d.relativeOccupancy, 0.25, true),
              p75: math.percentile(d.relativeOccupancy, 0.75, true),
              p90: math.percentile(d.relativeOccupancy, 0.9, true)
            }
            delete d.relativeOccupancy;
            return d;
          });
          profile[metric].sort((a, b) => a.period - b.period);
        }

        output.profiles.push(profile);
      }
    }

    await mkdir(this.profilesDir, { recursive: true });
    const outputPath = `${this.profilesDir}/profiles_${this.options.space}.json`;
    await writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log('Generated profiles saved to', outputPath);
  
  }

  /**
   * @description Retrieves occupancy data from Sensource API for the specified space and date range, with caching to avoid redundant API calls.
     * The data is retrieved in chunks of half-years to manage API limits and potential timeouts. 
     * After retrieving the data, data are processed
   */
  async getOccupancyData(){
    await mkdir(this.cacheDir, { recursive: true });

    const dateChunks = this.chunkByCalendarHalfYears(this.options.startDate);
    const promises = dateChunks.map(({start, end}) => this.getChunkOccupancyData(start, end));
    await Promise.all(promises);

    // Remove duplicates (Sensource may return overlapping data for adjacent chunks)
    const byTimestamp = new Map();
    for (const row of this.data) {
      const key = row.recordDate_minute_30;
      if (!byTimestamp.has(key)) {
      byTimestamp.set(key, row);
      }
    }
    this.data = Array.from(byTimestamp.values());
    this.parseData();
    this.data.forEach(row => this.setHours(row));
  }

  /**
   * @description Parses and preprocesses the raw occupancy data retrieved from Sensource API.
   * - Filters out rows with record errors
   * - Sorts data by date
   * - Calculates relative occupancy as a percentage of capacity
   * - Extracts local date parts (year, month, day, hour, weekday) in the library's timezone for further analysis
   * - Estimates open/close times for each day based on entry/exit thresholds and assigns schedule types
   */
  parseData(){
    this.data = this.data.filter(row => !row.recordError);

    // sort by date
    this.data.sort((a, b) => new Date(a.recordDate_minute_30) - new Date(b.recordDate_minute_30));

    this.data.forEach(row => {
      row.date = new Date(row.recordDate_minute_30);
      row.avgoccupancy = Math.round(parseFloat(row.avgoccupancy));
      row.localDate = this.getLocalDateParts(row.date);
      row.relativeOccupancy = Math.round((row.avgoccupancy / this.options.capacity) * 100);
    });
    //console.log(util.inspect(this.hours.slice(-2), { showHidden: false, depth: null, colors: true }))
    //console.log(util.inspect(this.data.slice(-24), { showHidden: false, depth: null, colors: true }))
  }

  /**
   * @description Exports the estimated library hours for each day to a CSV file in the reports directory
   */
  async exportHours(){
    await mkdir(this.reportsDir, { recursive: true });
    const path = `${this.reportsDir}/hours_${this.options.space}.csv`;
    const d = this.hours.map(h => {
      return {
        date: h.date,
        weekday: h.weekday,
        open: h.open ? h.open.localDate.dt : null,
        close: h.close ? h.close.localDate.dt : null,
        scheduleType: h.scheduleType
      }
    });
    return new Promise((resolve, reject) => {
      writeToPath(path, d, { headers: true })
        .on('error', err => reject(err))
        .on('finish', () => resolve(path));
    });
  }

  /**
   * @description Determines the schedule type (reduced, normal, expanded, summer) based on open/close times and configured thresholds
   * @param {Object} open - The open time data object from this.hours
   * @param {Object} close - The close time data object from this.hours
   * @returns {string|null} - The schedule type or null if not determined
   */
  getScheduleType(open, close){
    if ( !(open && close) ) return null;
    const hoursBetween = math.getIntervalCountBetweenDates(open.date, close.date, 60);

    if ( this.options.expandedThreshold && hoursBetween >= this.options.expandedThreshold ){
      return 'expanded';
    }

    const summerStart = new Date(`${open.localDate.year}-06-10T00:00:00`);
    const summerEnd = new Date(`${open.localDate.year}-09-22T00:00:00`);
    if ( open.date >= summerStart && open.date <= summerEnd ){
      return 'summer';
    }
    if ( this.options.reducedThreshold && hoursBetween <= this.options.reducedThreshold ){
      return 'reduced';
    } else {
      return 'normal';
    }
  }

  /**
   * @description Attempt to estimate open/close times for a given data row based on configured entry/exit thresholds.
   * This definitely introduces error, but we don't have historical open/close times
   * @param {*} row 
   */
  setHours(row){
    let open, close, scheduleType;
    const nextDayBuffer = 10; // look at 10 rows (5 hours) of data from the next day to find close time, since some libraries may close after midnight
    let businessDate = row.localDate.date;
    let weekday = row.localDate.weekday;
    let h = parseInt(row.localDate.hour);
    if ( h <= nextDayBuffer / 2 ){ 
      let yesterday = new Date(row.date);
      yesterday.setDate(yesterday.getDate() - 1);
      const parts = this.getLocalDateParts(yesterday);
      businessDate = parts.date;
      weekday = parts.weekday;
    }
    
    const exists = this.hours.find(h => h.date === businessDate);
    if ( !exists ){ 
      const currentDateData = this.data.filter(d => d.localDate.date === businessDate);
      let tomorrow = new Date(currentDateData[currentDateData.length - 1].date);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow = this.getLocalDateParts(tomorrow).date;
      const tomorrowDateData = this.data.filter(d => d.localDate.date === tomorrow);
      const hours = [...currentDateData, ...tomorrowDateData.slice(0, nextDayBuffer)];
      open = hours.find(h => h.sumins >= this.options.openThreshold);
      close = [...hours].reverse().find(h => h.sumouts >= this.options.closeThreshold);
      this.hours.push({
        date: businessDate,
        weekday,
        open: open ? {...open} : null,
        close: close ? {...close} : null,
        scheduleType: this.getScheduleType(open, close)
      });
    } else {
      open = exists.open;
      close = exists.close;
      scheduleType = exists.scheduleType;
    }

    row.businessDate = businessDate;
    row.isOpen = open && close ? (row.date >= open.date && row.date <= close.date) : null;
    row.periodsFromOpen = open ? math.getIntervalCountBetweenDates(open.date, row.date) : null;
    row.periodsToClose = close ? math.getIntervalCountBetweenDates(row.date, close.date) : null;
    row.weekday = weekday;
    row.scheduleType = scheduleType;

  }

  /**
   * @description Gets date parts in the local timezone (pacific) for a given date.
   * @param {Date} date 
   * @returns {Object} Date parts
   */
  getLocalDateParts(date){
    let dateParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      weekday: 'short'
    }).formatToParts(date);

    dateParts = Object.fromEntries(
      dateParts.filter(p => p.type !== 'literal').map(p => [p.type, p.value])
    );

    dateParts.dt = `${dateParts.year}-${dateParts.month}-${dateParts.day}T${dateParts.hour}:${dateParts.minute}`;
    dateParts.date = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
    return dateParts;
  }

  /**
   * @description Retrieves occupancy data from Sensource API for the specified space and date range, with caching to avoid redundant API calls.
   * @param {string} start - The start date for the data retrieval.
   * @param {string} end - The end date for the data retrieval.
   * @returns {Promise<void>}
   */
  async getChunkOccupancyData(start, end){
    const cacheFileName = `occupancy_${this.options.space}_${start}_${end || 'present'}.json`;
    const cacheFilePath = path.join(this.cacheDir, cacheFileName);
    let data = [];

    if ( existsSync(cacheFilePath) ){
      console.log(`Loading occupancy data from cache: ${cacheFileName}`);
      data = JSON.parse(readFileSync(cacheFilePath, 'utf-8'));
    } else {
      data = await sensource.getOccupancyData({
        entityIds: this.options.space,
        startDate: start,
        endDate: end,
        dateGroupings: 'minute(30)',
        relativeDate: 'custom'
      });
      console.log(`Caching occupancy data to file: ${cacheFileName}`);
      await writeFile(cacheFilePath, JSON.stringify(data, null, 2), 'utf-8');
    }

    this.data.push(...data);
  }

  /**
   * @description Chunks the date range into half-year intervals for API data retrieval.
   * @param {string} isoStart - The start date in ISO format.
   * @returns {Array} An array of date ranges representing each half-year chunk.
   */
  chunkByCalendarHalfYears(isoStart) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoStart)) {
      throw new Error(`Invalid ISO date: ${isoStart}`);
    }

    const startDate = new Date(`${isoStart}T00:00:00Z`);
    if (Number.isNaN(startDate.getTime())) {
      throw new Error(`Invalid date: ${isoStart}`);
    }

    // Today (UTC date only)
    const now = new Date();
    const today = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    ));

    const fmt = (d) => d.toISOString().slice(0, 10);

    const year = startDate.getUTCFullYear();
    const month = startDate.getUTCMonth(); // 0-11

    // Move BACK to start of containing half-year
    let cursor =
      month < 6
        ? new Date(Date.UTC(year, 0, 1))  // Jan 1
        : new Date(Date.UTC(year, 6, 1)); // Jul 1

    const chunks = [];

    while (true) {
      const cy = cursor.getUTCFullYear();
      const cm = cursor.getUTCMonth();

      const next =
        cm === 0
          ? new Date(Date.UTC(cy, 6, 1))      // Jan -> Jul
          : new Date(Date.UTC(cy + 1, 0, 1)); // Jul -> next Jan

      if (today < next) {
        chunks.push({ start: fmt(cursor), end: null });
        break;
      }

      chunks.push({ start: fmt(cursor), end: fmt(next) });
      cursor = next;
    }

    return chunks;
  }
}