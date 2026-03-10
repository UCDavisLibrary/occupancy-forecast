import util from 'util';

class Utils {

  /**
   * @description Pretty-prints data to the console.
   * @param {*} data - The data to print.
   */
  prettyPrint(data){
    console.log(util.inspect(data, { showHidden: false, depth: null, colors: true }));
  }

  /**
   * @description Converts a time string in 12-hour format to 24-hour format.
   * @param {*} str - A time string in 12-hour format (e.g. "7:30am", "12:00pm")
   */
  to24HourTime(str){
    const match = str.match(/(\d{1,2}):?(\d{0,2})\s*(am|pm)/i);
    if ( !match ){
      throw new Error(`Invalid time format: ${str}`);
    }
    let [_, hours, minutes, meridiem] = match;
    hours = parseInt(hours);
    minutes = minutes ? parseInt(minutes) : 0;
    meridiem = meridiem.toLowerCase();

    if ( meridiem === 'pm' && hours !== 12 ){
      hours += 12;
    } else if ( meridiem === 'am' && hours === 12 ){
      hours = 0;
    }

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }

  /**
   * Expands a time range into slots (default 30 minutes).
   * - End is non-inclusive: [start, end)
   * - If end <= start, the range rolls into the next day.
   *
   * Returns objects: { time: "HH:MM", isNextDay: boolean }
   *
   * @param {string} start - "HH:MM"
   * @param {string} end   - "HH:MM"
   * @param {number} stepMinutes
   * @returns {{ time: string, isNextDay: boolean }[]}
   */
  expandRange(start, end, stepMinutes = 30) {
    const parse = (time) => {
      if (!/^\d{2}:\d{2}$/.test(time)) {
        throw new Error(`Invalid time format: ${time}`);
      }
      const [h, m] = time.split(':').map(Number);
      if (h < 0 || h > 23 || m < 0 || m > 59) {
        throw new Error(`Invalid time value: ${time}`);
      }
      return h * 60 + m;
    };

    const fmt = (minutes) => {
      const mod = ((minutes % 1440) + 1440) % 1440;
      const h = Math.floor(mod / 60);
      const m = mod % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    let startMin = parse(start);
    let endMin = parse(end);

    // If end is not after start, roll into next day
    if (endMin <= startMin) {
      endMin += 1440;
    }

    const slots = [];
    for (let cur = startMin; cur < endMin; cur += stepMinutes) {
      slots.push({
        time: fmt(cur),
        isNextDay: cur >= 1440
      });
    }

    return slots;
  }

  /**
   * @description Returns the next day after the given ISO date.
   * @param {string} isoDate - The ISO date string.
   * @returns {string} The ISO date string for the next day.
   */
  nextDay(isoDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
      throw new Error(`Invalid ISO date: ${isoDate}`);
    }

    const date = new Date(`${isoDate}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid date: ${isoDate}`);
    }

    date.setUTCDate(date.getUTCDate() + 1);

    return date.toISOString().slice(0, 10);
  }

  /**
   * @description Returns the short name of the weekday for the given ISO date.
   * @param {string} isoDate - The ISO date string.
   * @returns {string} The short name of the weekday.
   */
  getWeekdayShort(isoDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
      throw new Error(`Invalid ISO date: ${isoDate}`);
    }

    const date = new Date(`${isoDate}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid date: ${isoDate}`);
    }

    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      timeZone: 'UTC'
    }).format(date);
  }

  /**
   * @description Determines if the given ISO date falls roughly within the summer quarter.
   * @param {string} isoDate - The ISO date string.
   * @returns {boolean} True if the date falls within the summer quarter, false otherwise.
   */
  isSummerQuarter(isoDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
      throw new Error(`Invalid ISO date: ${isoDate}`);
    }

    const date = new Date(`${isoDate}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid date: ${isoDate}`);
    }

    const year = date.getUTCFullYear();
    const summerStart = new Date(`${year}-06-10T00:00:00Z`);
    const summerEnd = new Date(`${year}-09-22T00:00:00Z`);
    return date >= summerStart && date <= summerEnd;
  }

  /**
   * @description Determines if two objects have the same values for all their keys.
   * @param {Object} obj1 - The first object.
   * @param {Object} obj2 - The second object.
   * @returns {boolean} True if the objects have the same values for all keys, false otherwise.
   */
  objectsMatch(obj1, obj2){
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    if (keys1.length !== keys2.length) {
      return false;
    }
    for (const key of keys1) {
      if (obj1[key] !== obj2[key]) {
        return false;
      }
    }
    return true;
  }

  /**
   * @description Creates a new object containing only the specified keys from the original object.
   * @param {Object} obj - The original object
   * @param {string[]} keys - The keys to include in the new object
   * @returns {Object} - The new object containing only the specified keys
   */
  subsetObject(obj, keys){
    return keys.reduce((acc, key) => {
      if (key in obj) {
        acc[key] = obj[key];
      }
      return acc;
    }, {})
  }

}
export default new Utils();