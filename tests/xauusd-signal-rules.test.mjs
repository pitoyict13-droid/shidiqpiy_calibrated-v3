import assert from 'node:assert/strict';
import { getGoldSignal } from '../scripts/xauusd-signal-rules.js';

const cases = [
  [{event:'Nonfarm Payrolls', actual:150000, forecast:200000}, 'long'],
  [{event:'Nonfarm Payrolls', actual:250000, forecast:200000}, 'short'],
  [{event:'Unemployment Rate', actual:4.2, forecast:4.0}, 'long'],
  [{event:'Unemployment Rate', actual:3.8, forecast:4.0}, 'short'],
  [{event:'Initial Jobless Claims', actual:230000, forecast:220000}, 'long'],
  [{event:'Initial Jobless Claims', actual:210000, forecast:220000}, 'short'],
  [{event:'CPI', actual:2.8, forecast:3.0}, 'long'],
  [{event:'CPI', actual:3.2, forecast:3.0}, 'short'],
  [{event:'Unknown Indicator', actual:10, forecast:9}, 'wait'],
  [{event:'CPI', actual:null, forecast:3.0}, 'wait'],
  // Real-market formatted strings & expanded indicators
  [{event:'Non Farm Payrolls', actual:'165K', forecast:'65K', importance:3}, 'short'],
  [{event:'Core Inflation Rate MoM', actual:'0.3%', forecast:'0.2%', importance:3}, 'short'],
  [{event:'PPI MoM', actual:'0.2%', forecast:'0.4%', importance:3}, 'long'],
  [{event:'Michigan Consumer Sentiment Prel', actual:'51', forecast:'48', importance:3}, 'short'],
  [{event:'Retail Sales MoM', actual:'0.2%', forecast:'0%', importance:3}, 'short'],
  [{event:'Balance of Trade', actual:'2.826B', forecast:'0.81B', country:'AUD', importance:3}, 'long'],
  [{event:'Unemployment Rate', actual:'6.7%', forecast:'6.5%', country:'CAD', importance:3}, 'short'],
];

for (const [input, expected] of cases) {
  assert.equal(getGoldSignal(input).dir, expected, JSON.stringify(input));
}
console.log(`Passed ${cases.length}/${cases.length} XAUUSD signal tests`);
