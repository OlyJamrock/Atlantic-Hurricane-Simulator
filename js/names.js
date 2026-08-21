// names.js — the real, official Atlantic basin tropical cyclone name
// lists as maintained by the WMO (21 names each, skipping Q/U/X/Y/Z,
// alternating gender). Six lists rotate every year and repeat every six
// years, with retired names replaced. Verified against NHC/WMO reporting
// as of the 2026 season (includes the Melissa -> Molly retirement on the
// 2031 list, effective the March 2026 WMO meeting).
//
// The sim's calendar starts at year 2026 (day 0 = Jan 1, 2026) and simply
// wraps through this same six-list rotation for any simulated year beyond
// 2031, which is exactly what the real WMO rotation does through 2032 and
// onward (2032 reuses the 2026 list, etc).

export const NAME_LISTS = {
  2026: ['Arthur', 'Bertha', 'Cristobal', 'Dolly', 'Edouard', 'Fay', 'Gonzalo', 'Hanna', 'Isaias', 'Josephine', 'Kyle', 'Leah', 'Marco', 'Nana', 'Omar', 'Paulette', 'Rene', 'Sally', 'Teddy', 'Vicky', 'Wilfred'],
  2027: ['Ana', 'Bill', 'Claudette', 'Danny', 'Elsa', 'Fred', 'Grace', 'Henri', 'Imani', 'Julian', 'Kate', 'Larry', 'Mindy', 'Nicholas', 'Odette', 'Peter', 'Rose', 'Sam', 'Teresa', 'Victor', 'Wanda'],
  2028: ['Alex', 'Bonnie', 'Colin', 'Danielle', 'Earl', 'Farrah', 'Gaston', 'Hermine', 'Idris', 'Julia', 'Karl', 'Lisa', 'Martin', 'Nicole', 'Owen', 'Paula', 'Richard', 'Shary', 'Tobias', 'Virginie', 'Walter'],
  2029: ['Arlene', 'Bret', 'Cindy', 'Don', 'Emily', 'Franklin', 'Gert', 'Harold', 'Idalia', 'Jose', 'Katia', 'Lee', 'Margot', 'Nigel', 'Ophelia', 'Philippe', 'Rina', 'Sean', 'Tammy', 'Vince', 'Whitney'],
  2030: ['Alberto', 'Brianna', 'Chris', 'Debby', 'Ernesto', 'Francine', 'Gordon', 'Holly', 'Isaac', 'Joyce', 'Kirk', 'Leslie', 'Miguel', 'Nadine', 'Oscar', 'Patty', 'Rafael', 'Sara', 'Tony', 'Valerie', 'William'],
  2031: ['Andrea', 'Barry', 'Chantal', 'Dexter', 'Erin', 'Fernand', 'Gabrielle', 'Humberto', 'Imelda', 'Jerry', 'Karen', 'Lorenzo', 'Molly', 'Nestor', 'Olga', 'Pablo', 'Rebekah', 'Sebastien', 'Tanya', 'Van', 'Wendy'],
};

// Official NHC/WMO Eastern North Pacific name lists (24 names each,
// recycled every six years same as the Atlantic) — verified directly
// against the current NHC naming page as of the 2026 season.
export const EPAC_NAME_LISTS = {
  2026: ['Amanda', 'Boris', 'Cristina', 'Douglas', 'Elida', 'Fausto', 'Genevieve', 'Hernan', 'Iselle', 'Julio', 'Karina', 'Lowell', 'Marie', 'Norbert', 'Odalys', 'Polo', 'Rachel', 'Simon', 'Trudy', 'Vance', 'Winnie', 'Xavier', 'Yolanda', 'Zeke'],
  2027: ['Andres', 'Blanca', 'Carlos', 'Dolores', 'Enrique', 'Felicia', 'Guillermo', 'Hilda', 'Ignacio', 'Jimena', 'Kevin', 'Linda', 'Marty', 'Nora', 'Olaf', 'Pamela', 'Rick', 'Sandra', 'Terry', 'Vivian', 'Waldo', 'Xina', 'York', 'Zelda'],
  2028: ['Agatha', 'Blas', 'Celia', 'Darby', 'Estelle', 'Frank', 'Georgette', 'Howard', 'Ivette', 'Javier', 'Kay', 'Lester', 'Madeline', 'Newton', 'Orlene', 'Paine', 'Roslyn', 'Seymour', 'Tina', 'Virgil', 'Winifred', 'Xavier', 'Yolanda', 'Zeke'],
  2029: ['Adrian', 'Beatriz', 'Calvin', 'Debora', 'Eugene', 'Fernanda', 'Greg', 'Hilary', 'Irwin', 'Jova', 'Kenneth', 'Lidia', 'Max', 'Norma', 'Otilio', 'Pilar', 'Ramon', 'Selma', 'Todd', 'Veronica', 'Wiley', 'Xina', 'York', 'Zelda'],
  2030: ['Aletta', 'Bud', 'Carlotta', 'Daniel', 'Emilia', 'Fabio', 'Gilma', 'Hector', 'Ileana', 'Jake', 'Kristy', 'Lane', 'Miriam', 'Norman', 'Olivia', 'Paul', 'Rosa', 'Sergio', 'Tara', 'Vicente', 'Willa', 'Xavier', 'Yolanda', 'Zeke'],
  2031: ['Alvin', 'Barbara', 'Cosme', 'Dalila', 'Erick', 'Flossie', 'Gil', 'Henriette', 'Ivo', 'Juliette', 'Kiko', 'Lorena', 'Mario', 'Narda', 'Octave', 'Priscilla', 'Raymond', 'Sonia', 'Tico', 'Velma', 'Wallis', 'Xina', 'York', 'Zelda'],
};

// Overflow list used if a season somehow exhausts all 21 standard names
// (has happened once, 2005 pre-supplemental-list era used Greek letters;
// the WMO retired the Greek-letter approach after 2020 and now uses this
// dedicated supplemental list instead).
export const SUPPLEMENTAL_LIST = [
  'Adria', 'Braylen', 'Caridad', 'Deshawn', 'Emery', 'Foster', 'Gemma',
  'Heath', 'Isla', 'Jacobus', 'Kenzie', 'Lucio', 'Makayla', 'Nolan',
  'Orlanda', 'Pax', 'Ronin', 'Sophie', 'Tayshaun', 'Viviana', 'Will',
];

const BASE_YEAR = 2026;
const ROTATION_YEARS = 6;

export class NameCycler {
  // lists: which basin's rotating name-list object to draw from
  // (defaults to the Atlantic NAME_LISTS above; pass EPAC_NAME_LISTS for
  // the Eastern Pacific instance).
  constructor(lists = NAME_LISTS) {
    this._lists = lists;
    this._indexByYear = new Map(); // calendarYear -> next index into that year's list
  }

  // yearIndex: 0 for the sim's first year (real calendar year = 2026 + yearIndex)
  next(yearIndex) {
    const calendarYear = BASE_YEAR + yearIndex;
    const listYear = BASE_YEAR + (((calendarYear - BASE_YEAR) % ROTATION_YEARS) + ROTATION_YEARS) % ROTATION_YEARS;
    const list = this._lists[listYear];
    const i = this._indexByYear.get(calendarYear) || 0;
    this._indexByYear.set(calendarYear, i + 1);
    if (i < list.length) return list[i];
    const overflowIdx = i - list.length;
    return SUPPLEMENTAL_LIST[overflowIdx % SUPPLEMENTAL_LIST.length];
  }
}

// Every tropical (and subtropical) cyclone gets an operational number the
// moment it's designated — "01L", "02L", etc. for the Atlantic ("L")
// basin, "01E", "02E", etc. for the Eastern Pacific ("E") basin —
// regardless of whether it ever gets strong enough to be named. Naming
// only happens separately, once/if a system reaches 34kt (see
// World.tick() in simulation.js) — so the 7th system of the year might
// be "07L" for its whole life, while the 5th named storm might actually
// be, say, the 9th system overall ("09L" before naming, "Emily" after).
// The counter resets each calendar year, matching real operational
// numbering, and each basin keeps its own independent count.
export class CycloneNumberer {
  constructor(suffix = 'L') {
    this._suffix = suffix;
    this._countByYear = new Map();
  }

  next(yearIndex) {
    const calendarYear = BASE_YEAR + yearIndex;
    const n = (this._countByYear.get(calendarYear) || 0) + 1;
    this._countByYear.set(calendarYear, n);
    return `${String(n).padStart(2, '0')}${this._suffix}`;
  }
}

export function calendarYearOf(dayNum) {
  return BASE_YEAR + Math.floor(dayNum / 365);
}
