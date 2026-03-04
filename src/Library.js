import { mkdir, writeFile } from 'fs/promises';
import { writeToPath } from 'fast-csv';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import util from 'util';

import sensource from "./sensource.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default class Library {

  constructor(options){
    
    const requiredOptions = ['space', 'startDate', 'openThreshold', 'closeThreshold', 'capacity'];
    for ( const option of requiredOptions ){
      if ( options[option] === undefined ){
        throw new Error(`Missing required option: ${option}`);
      }
    }

    this.space = options.space;
    this.startDate = options.startDate;
    this.openThreshold = parseInt(options.openThreshold);
    this.closeThreshold = parseInt(options.closeThreshold);
    this.capacity = parseInt(options.capacity);
    this.data = [];
    this.hours = [];

    this.cacheDir = path.join(__dirname, '../data/cache');
    this.reportsDir = path.join(__dirname, '../data/reports');
  }

  async generate(){
    await this.getOccupancyData();
  }

  async getOccupancyData(){
    await mkdir(this.cacheDir, { recursive: true });

    const dateChunks = this.chunkByCalendarHalfYears(this.startDate);
    const promises = dateChunks.map(({start, end}) => this._getChunkOccupancyData(start, end));
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

    this.data = this.data.filter(row => !row.recordError);

    // sort by date
    this.data.sort((a, b) => new Date(a.recordDate_minute_30) - new Date(b.recordDate_minute_30));

    this.data.forEach(row => {
      row.date = new Date(row.recordDate_minute_30);
      row.avgoccupancy = Math.round(parseFloat(row.avgoccupancy));
      row.localDate = this.getLocalDateParts(row.date);
      row.relativeOccupancy = Math.round((row.avgoccupancy / this.capacity) * 100);
    });

    this.data.forEach(row => this.setHours(row));
    //console.log(util.inspect(this.hours.slice(-2), { showHidden: false, depth: null, colors: true }))
    //console.log(util.inspect(this.data.slice(-24), { showHidden: false, depth: null, colors: true }))

  }

  async exportHours(){
    await mkdir(this.reportsDir, { recursive: true });
    const path = `${this.reportsDir}/hours_${this.space}.csv`;
    const d = this.hours.map(h => {
      return {
        date: h.date,
        weekday: h.weekday,
        open: h.open ? h.open.localDate.dt : null,
        close: h.close ? h.close.localDate.dt : null
      }
    });
    return new Promise((resolve, reject) => {
      writeToPath(path, d, { headers: true })
        .on('error', err => reject(err))
        .on('finish', () => resolve(path));
    });
  }

  setHours(row){
    let open, close;
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
      open = hours.find(h => h.sumins >= this.openThreshold);
      close = [...hours].reverse().find(h => h.sumouts >= this.closeThreshold);
      this.hours.push({
        date: businessDate,
        weekday,
        open: open ? {...open} : null,
        close: close ? {...close} : null
      });
    } else {
      open = exists.open;
      close = exists.close;
    }

    row.businessDate = businessDate;
    row.isOpen = open && close ? (row.date >= open.date && row.date <= close.date) : null;
    row.periodsFromOpen = open ? this.getIntervalCountBetweenDates(open.date, row.date) : null;
    row.periodsToClose = close ? this.getIntervalCountBetweenDates(row.date, close.date) : null;

  }

  getIntervalCountBetweenDates(start, end, intervalMinutes=30){
    const absoluteDiffInSeconds = Math.abs((end.getTime() - start.getTime()) / 1000);
    return Math.ceil(absoluteDiffInSeconds / (intervalMinutes * 60));
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

  async _getChunkOccupancyData(start, end){
    const cacheFileName = `occupancy_${this.space}_${start}_${end || 'present'}.json`;
    const cacheFilePath = path.join(this.cacheDir, cacheFileName);
    let data = [];

    if ( existsSync(cacheFilePath) ){
      console.log(`Loading occupancy data from cache: ${cacheFileName}`);
      data = JSON.parse(readFileSync(cacheFilePath, 'utf-8'));
    } else {
      data = await sensource.getOccupancyData({
        entityIds: this.space,
        startDate: start,
        endDate: end,
        dateGroupings: 'minute(30)',
        relativeDate: 'custom'
      });
      console.log(`Caching occupancy data to file: ${cacheFileName}`);
      await writeFile(cacheFilePath, JSON.stringify(data), 'utf-8');
    }

    this.data.push(...data);
  }

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