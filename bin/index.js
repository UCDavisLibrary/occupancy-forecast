import { Command } from 'commander';
import util from 'util';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import Library from '../src/Library.js';

import sensource from '../src/sensource.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8')
);
const { version, description, name } = packageJson;

const program = new Command();

function applySharedOptions(cmd) {
  return cmd
    .option('--space <space>', 'Sensource space ID')
    .option('--startDate <startDate>', 'Start date to retrieve historical data from (YYYY-MM-DD). Will round to nearest half-year, so 2024-03-01 would round to 2024-01-01, and 2024-09-01 would round to 2024-07-01)')
    .option('--openThreshold <openThreshold>', 'Threshold to determine if the library is considered open based on number of people entering')
    .option('--closeThreshold <closeThreshold>', 'Threshold to determine if the library is considered closed based on number of people leaving')
    .option('--config <path>', 'Path to config file')
}


function logObject(data){
  console.log(util.inspect(data, { showHidden: false, depth: null, colors: true }));
}

function mergeOptionsWithConfig(options){
  if ( options.config ){
    const configPath = resolve(process.cwd(), options.config);
    console.log('Using config file:', configPath);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    return {...options, ...config};
  }
  return options;
}

program
  .name(name)
  .description(description)
  .version(version);

applySharedOptions( program.command('generate') )
  .description('Generate same-day occupancy profiles for a library based on historical data')
  .action(async (options) => {
    options = mergeOptionsWithConfig(options);

    const library = new Library(options);
    await library.generate();
  });

program
  .command('spaces')
  .description('List available Sensource spaces')
  .action(async () => {
    const spaces = await sensource.getSpaces();
    logObject(spaces);
  });

applySharedOptions( program.command('hours') )
  .description('Export estimated library open/close hours for historical data')
  .action(async (options) => {
    options = mergeOptionsWithConfig(options);

    const library = new Library(options);
    await library.getOccupancyData();
    await library.exportHours();
  });


program.parse();