class MathUtils {

  /**
   * @description Calculates the number of intervals of a given length (in minutes) between two dates.
   * @param {Date} start - The start date
   * @param {Date} end - The end date
   * @param {number} intervalMinutes - The length of each interval in minutes (default is 30)
   * @returns {number} - The number of intervals between the two dates
   * @returns 
   */
  getIntervalCountBetweenDates(start, end, intervalMinutes=30){
    const absoluteDiffInSeconds = Math.abs((end.getTime() - start.getTime()) / 1000);
    return Math.ceil(absoluteDiffInSeconds / (intervalMinutes * 60));
  }

  /**
   * @description Calculates the median of an array of numbers.
   * @param {number[]} values - The array of numbers
   * @param {boolean} sorted - Whether the array is already sorted
   * @returns {number} - The median value
   */
  median(values, sorted=false) {
    if(values.length ===0) return 0;
    

    if (!sorted) {
      values = [...values];
      values.sort(function(a,b){
        return a-b;
      });
    }

    const half = Math.floor(values.length / 2);

    if (values.length % 2)
      return values[half];
    else
      return (values[half - 1] + values[half]) / 2.0;
  }

  /**
   * @description Calculates the p-th percentile of an array of numbers.
   * @param {number[]} values - The array of numbers
   * @param {number} p - The percentile to calculate (0-1)
   * @param {boolean} sorted - Whether the array is already sorted
   * @returns {number} - The p-th percentile value
   */
  percentile(values, p, sorted=false) {
    if (!sorted) {
      values = [...values];
      values.sort(function(a,b){
        return a-b;
      });
    }
    const n = values.length;
    if (n === 0) return null;
    if (p <= 0) return values[0];
    if (p >= 1) return values[n - 1];

    const pos = (n - 1) * p;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);

    if (lo === hi) return values[lo];

    const weight = pos - lo;
    const v = values[lo] + weight * (values[hi] - values[lo]);
    return Math.round(v);
  }

  /**
   * @description Generates all possible combinations of elements from an array.
   * @param {Array} arr - The input array
   * @returns {Array} - An array of all possible combinations
   */
  combinations(arr) {
    const result = [];

    function backtrack(start, current) {
      if (current.length > 0) {
        result.push([...current]);
      }

      for (let i = start; i < arr.length; i++) {
        current.push(arr[i]);
        backtrack(i + 1, current);
        current.pop();
      }
    }

    backtrack(0, []);
    return result;
  }

  cartesianProductObjects(choices) {
    const entries = Object.entries(choices);

    // If there are no keys, return an empty array (no meaningful full objects).
    if (entries.length === 0) return [];

    // Validate and short-circuit if any value list is empty -> no full combinations.
    for (const [k, vals] of entries) {
      if (!Array.isArray(vals)) {
        throw new TypeError(`Expected array for key "${k}", got ${typeof vals}`);
      }
      if (vals.length === 0) return [];
    }

    // Start with one empty object, then expand for each key.
    let combos = [{}];

    for (const [key, values] of entries) {
      const next = [];
      for (const combo of combos) {
        for (const v of values) {
          next.push({ ...combo, [key]: v });
        }
      }
      combos = next;
    }

    return combos;
  }


}

export default new MathUtils()