/**
 * @file alternity-actor-data.js
 * @description Phase 1 – Data Layer: Character state persistence for the Alternity Fastplay system.
 *
 * Extends the native Foundry Actor document with custom Alternity-specific state.
 * All state must be serializable/deserializable — no Functions, Dates, or RegExps stored.
 */


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Valid ability types as defined in the Alternity Fastplay ruleset. */
const ABILITY_TYPES = Object.freeze({
    STANCE:  'Stance',
    PASSIVE: 'Passive',
    ACTION:  'Action',
});

/** The six core ability scores. */
const ABILITIES = Object.freeze(['STR', 'DEX', 'CON', 'INT', 'WIL', 'PER']);

/** Full skill list from the Alternity Supplemental Hero Sheet (CharShee.pdf). */
const SKILL_DEFINITIONS = Object.freeze([
    // STR Skills
    { id: 'str-armor',           name: 'Armor Operation',             ability: 'STR', isSpecialty: false },
    { id: 'str-combat',          name: 'Combat',                      ability: 'STR', isSpecialty: false },
    { id: 'str-powered-combat',  name: 'Powered',                     ability: 'STR', isSpecialty: true,  parent: 'str-combat', cannotBeUsedUntrained: true },
    { id: 'str-athletics',       name: 'Athletics',                   ability: 'STR', isSpecialty: false },
    { id: 'str-climb',           name: 'Climb',                       ability: 'STR', isSpecialty: true,  parent: 'str-athletics' },
    { id: 'str-jump',            name: 'Jump',                        ability: 'STR', isSpecialty: true,  parent: 'str-athletics' },
    { id: 'str-throw',           name: 'Throw',                       ability: 'STR', isSpecialty: true,  parent: 'str-athletics' },
    { id: 'str-heavy-wpns',      name: 'Heavy Weapons',               ability: 'STR', isSpecialty: false },
    { id: 'str-direct-fire',     name: 'Direct fire',                 ability: 'STR', isSpecialty: true,  parent: 'str-heavy-wpns' },
    { id: 'str-indirect-fire',   name: 'Indirect fire',               ability: 'STR', isSpecialty: true,  parent: 'str-heavy-wpns' },
    { id: 'str-melee',           name: 'Melee Weapons',               ability: 'STR', isSpecialty: false },
    { id: 'str-blade',           name: 'Blade',                       ability: 'STR', isSpecialty: true,  parent: 'str-melee' },
    { id: 'str-bludgeon',        name: 'Bludgeon',                    ability: 'STR', isSpecialty: true,  parent: 'str-melee' },
    { id: 'str-powered-melee',   name: 'Powered',                     ability: 'STR', isSpecialty: true,  parent: 'str-melee', cannotBeUsedUntrained: true },
    { id: 'str-unarmed',         name: 'Unarmed Attack',              ability: 'STR', isSpecialty: false },
    { id: 'str-brawl',           name: 'Brawl',                       ability: 'STR', isSpecialty: true,  parent: 'str-unarmed' },
    { id: 'str-power',           name: 'Power',                       ability: 'STR', isSpecialty: true,  parent: 'str-unarmed' },
    { id: 'str-martial-arts',    name: 'Martial arts',                ability: 'STR', isSpecialty: true,  parent: 'str-unarmed', cannotBeUsedUntrained: true },

    // DEX Skills
    { id: 'dex-acrobatics',      name: 'Acrobatics',                  ability: 'DEX', isSpecialty: false },
    { id: 'dex-daredevil',       name: 'Daredevil',                   ability: 'DEX', isSpecialty: true,  parent: 'dex-acrobatics', cannotBeUsedUntrained: true },
    { id: 'dex-defensive-ma',    name: 'Defensive martial arts',      ability: 'DEX', isSpecialty: true,  parent: 'dex-acrobatics', cannotBeUsedUntrained: true },
    { id: 'dex-dodge',           name: 'Dodge',                       ability: 'DEX', isSpecialty: true,  parent: 'dex-acrobatics' },
    { id: 'dex-fall',            name: 'Fall',                        ability: 'DEX', isSpecialty: true,  parent: 'dex-acrobatics' },
    { id: 'dex-flight',          name: 'Flight',                      ability: 'DEX', isSpecialty: true,  parent: 'dex-acrobatics', cannotBeUsedUntrained: true },
    { id: 'dex-zero-g',          name: 'Zero-g training',             ability: 'DEX', isSpecialty: true,  parent: 'dex-acrobatics', cannotBeUsedUntrained: true },
    { id: 'dex-manipulation',    name: 'Manipulation',                ability: 'DEX', isSpecialty: false },
    { id: 'dex-lockpick',        name: 'Lockpick',                    ability: 'DEX', isSpecialty: true,  parent: 'dex-manipulation', cannotBeUsedUntrained: true },
    { id: 'dex-pickpocket',      name: 'Pickpocket',                  ability: 'DEX', isSpecialty: true,  parent: 'dex-manipulation', cannotBeUsedUntrained: true },
    { id: 'dex-prestidigation',  name: 'Prestidigitation',            ability: 'DEX', isSpecialty: true,  parent: 'dex-manipulation', cannotBeUsedUntrained: true },
    { id: 'dex-ranged-mod',      name: 'Ranged Wpns, Mod.',           ability: 'DEX', isSpecialty: false },
    { id: 'dex-pistol',          name: 'Pistol',                      ability: 'DEX', isSpecialty: true,  parent: 'dex-ranged-mod' },
    { id: 'dex-rifle',           name: 'Rifle',                       ability: 'DEX', isSpecialty: true,  parent: 'dex-ranged-mod', cannotBeUsedUntrained: true },
    { id: 'dex-smg',             name: 'SMG',                         ability: 'DEX', isSpecialty: true,  parent: 'dex-ranged-mod', cannotBeUsedUntrained: true },
    { id: 'dex-ranged-prim',     name: 'Ranged Wpns, Prim.',          ability: 'DEX', isSpecialty: false },
    { id: 'dex-bow',             name: 'Bow',                         ability: 'DEX', isSpecialty: true,  parent: 'dex-ranged-prim', cannotBeUsedUntrained: true },
    { id: 'dex-crossbow',        name: 'Crossbow',                    ability: 'DEX', isSpecialty: true,  parent: 'dex-ranged-prim', cannotBeUsedUntrained: true },
    { id: 'dex-flintlock',       name: 'Flintlock',                   ability: 'DEX', isSpecialty: true,  parent: 'dex-ranged-prim', cannotBeUsedUntrained: true },
    { id: 'dex-sling',           name: 'Sling',                       ability: 'DEX', isSpecialty: true,  parent: 'dex-ranged-prim', cannotBeUsedUntrained: true },
    { id: 'dex-stealth',         name: 'Stealth',                     ability: 'DEX', isSpecialty: false },
    { id: 'dex-hide',            name: 'Hide',                        ability: 'DEX', isSpecialty: true,  parent: 'dex-stealth' },
    { id: 'dex-shadow',          name: 'Shadow',                      ability: 'DEX', isSpecialty: true,  parent: 'dex-stealth' },
    { id: 'dex-sneak',           name: 'Sneak',                       ability: 'DEX', isSpecialty: true,  parent: 'dex-stealth' },
    { id: 'dex-vehicle-op',      name: 'Vehicle Operation',           ability: 'DEX', isSpecialty: false },
    { id: 'dex-air',             name: 'Air',                         ability: 'DEX', isSpecialty: true,  parent: 'dex-vehicle-op', cannotBeUsedUntrained: true },
    { id: 'dex-land',            name: 'Land',                        ability: 'DEX', isSpecialty: true,  parent: 'dex-vehicle-op' },
    { id: 'dex-space',           name: 'Space',                       ability: 'DEX', isSpecialty: true,  parent: 'dex-vehicle-op', cannotBeUsedUntrained: true },
    { id: 'dex-water',           name: 'Water',                       ability: 'DEX', isSpecialty: true,  parent: 'dex-vehicle-op' },

    // CON Skills
    { id: 'con-movement',        name: 'Movement',                    ability: 'CON', isSpecialty: false },
    { id: 'con-race',            name: 'Race',                        ability: 'CON', isSpecialty: true,  parent: 'con-movement' },
    { id: 'con-swim',            name: 'Swim',                        ability: 'CON', isSpecialty: true,  parent: 'con-movement' },
    { id: 'con-trailblazing',    name: 'Trailblazing',                ability: 'CON', isSpecialty: true,  parent: 'con-movement' },
    { id: 'con-stamina',         name: 'Stamina',                     ability: 'CON', isSpecialty: false },
    { id: 'con-endurance',       name: 'Endurance',                   ability: 'CON', isSpecialty: true,  parent: 'con-stamina' },
    { id: 'con-resist-pain',     name: 'Resist pain',                 ability: 'CON', isSpecialty: true,  parent: 'con-stamina', cannotBeUsedUntrained: true },
    { id: 'con-survival',        name: 'Survival',                    ability: 'CON', isSpecialty: false },
    { id: 'con-survival-train',  name: 'Survival train.',             ability: 'CON', isSpecialty: true,  parent: 'con-survival' },

    // INT Skills
    { id: 'int-business',        name: 'Business',                    ability: 'INT', isSpecialty: false, cannotBeUsedUntrained: true },
    { id: 'int-corporate',       name: 'Corporate',                   ability: 'INT', isSpecialty: true,  parent: 'int-business', cannotBeUsedUntrained: true },
    { id: 'int-illicit-biz',     name: 'Illicit business',            ability: 'INT', isSpecialty: true,  parent: 'int-business', cannotBeUsedUntrained: true },
    { id: 'int-small-biz',       name: 'Small business',              ability: 'INT', isSpecialty: true,  parent: 'int-business', cannotBeUsedUntrained: true },
    { id: 'int-computer-sci',    name: 'Computer Science',            ability: 'INT', isSpecialty: false, cannotBeUsedUntrained: true },
    { id: 'int-hacking',         name: 'Hacking',                     ability: 'INT', isSpecialty: true,  parent: 'int-computer-sci', cannotBeUsedUntrained: true },
    { id: 'int-hardware',        name: 'Hardware',                    ability: 'INT', isSpecialty: true,  parent: 'int-computer-sci', cannotBeUsedUntrained: true },
    { id: 'int-programming',     name: 'Programming',                 ability: 'INT', isSpecialty: true,  parent: 'int-computer-sci', cannotBeUsedUntrained: true },
    { id: 'int-demolitions',     name: 'Demolitions',                 ability: 'INT', isSpecialty: false, cannotBeUsedUntrained: true },
    { id: 'int-disarm',          name: 'Disarm',                      ability: 'INT', isSpecialty: true,  parent: 'int-demolitions', cannotBeUsedUntrained: true },
    { id: 'int-scratch-built',   name: 'Scratch-built',               ability: 'INT', isSpecialty: true,  parent: 'int-demolitions', cannotBeUsedUntrained: true },
    { id: 'int-set-explosives',  name: 'Set explosives',              ability: 'INT', isSpecialty: true,  parent: 'int-demolitions', cannotBeUsedUntrained: true },
    { id: 'int-knowledge',       name: 'Knowledge',                   ability: 'INT', isSpecialty: false },
    { id: 'int-computer-op',     name: 'Computer op.',                ability: 'INT', isSpecialty: true,  parent: 'int-knowledge', cannotBeUsedUntrained: true },
    { id: 'int-deduce',          name: 'Deduce',                      ability: 'INT', isSpecialty: true,  parent: 'int-knowledge', cannotBeUsedUntrained: true },
    { id: 'int-firstaid',        name: 'First aid',                   ability: 'INT', isSpecialty: true,  parent: 'int-knowledge', cannotBeUsedUntrained: true },
    { id: 'int-language',        name: 'Language',                    ability: 'INT', isSpecialty: true,  parent: 'int-knowledge' },
    { id: 'int-law',             name: 'Law',                         ability: 'INT', isSpecialty: false, cannotBeUsedUntrained: true },
    { id: 'int-court-proc',      name: 'Court proc.',                 ability: 'INT', isSpecialty: true,  parent: 'int-law', cannotBeUsedUntrained: true },
    { id: 'int-law-enforc',      name: 'Law enforc.',                 ability: 'INT', isSpecialty: true,  parent: 'int-law', cannotBeUsedUntrained: true },
    { id: 'int-life-sci',        name: 'Life Science',                ability: 'INT', isSpecialty: false, cannotBeUsedUntrained: true },
    { id: 'int-biology',         name: 'Biology',                     ability: 'INT', isSpecialty: true,  parent: 'int-life-sci', cannotBeUsedUntrained: true },
    { id: 'int-botany',          name: 'Botany',                      ability: 'INT', isSpecialty: true,  parent: 'int-life-sci', cannotBeUsedUntrained: true },
    { id: 'int-genetics',        name: 'Genetics',                    ability: 'INT', isSpecialty: true,  parent: 'int-life-sci', cannotBeUsedUntrained: true },
    { id: 'int-xenology',        name: 'Xenology',                    ability: 'INT', isSpecialty: true,  parent: 'int-life-sci', cannotBeUsedUntrained: true },
    { id: 'int-zoology',         name: 'Zoology',                     ability: 'INT', isSpecialty: true,  parent: 'int-life-sci', cannotBeUsedUntrained: true },
    { id: 'int-med-sci',         name: 'Medical Science',             ability: 'INT', isSpecialty: false, cannotBeUsedUntrained: true },
    { id: 'int-forensics',       name: 'Forensics',                   ability: 'INT', isSpecialty: true,  parent: 'int-med-sci', cannotBeUsedUntrained: true },
    { id: 'int-medical-know',    name: 'Medical know.',               ability: 'INT', isSpecialty: true,  parent: 'int-med-sci', cannotBeUsedUntrained: true },
    { id: 'int-psychology',      name: 'Psychology',                  ability: 'INT', isSpecialty: true,  parent: 'int-med-sci', cannotBeUsedUntrained: true },
    { id: 'int-surgery',         name: 'Surgery',                     ability: 'INT', isSpecialty: true,  parent: 'int-med-sci', cannotBeUsedUntrained: true },
    { id: 'int-treatment',       name: 'Treatment',                   ability: 'INT', isSpecialty: true,  parent: 'int-med-sci', cannotBeUsedUntrained: true },
    { id: 'int-xenomedicine',    name: 'Xenomedicine',                ability: 'INT', isSpecialty: true,  parent: 'int-med-sci', cannotBeUsedUntrained: true },
    { id: 'int-navigation',      name: 'Navigation',                  ability: 'INT', isSpecialty: false, cannotBeUsedUntrained: true },
    { id: 'int-drivespace',      name: 'Drivespace',                  ability: 'INT', isSpecialty: true,  parent: 'int-navigation', cannotBeUsedUntrained: true },
    { id: 'int-system-nav',      name: 'System',                      ability: 'INT', isSpecialty: true,  parent: 'int-navigation', cannotBeUsedUntrained: true },
    { id: 'int-surface',         name: 'Surface',                     ability: 'INT', isSpecialty: true,  parent: 'int-navigation', cannotBeUsedUntrained: true },
    { id: 'int-physical-sci',    name: 'Physical Science',            ability: 'INT', isSpecialty: false, cannotBeUsedUntrained: true },
    { id: 'int-astronomy',       name: 'Astronomy',                   ability: 'INT', isSpecialty: true,  parent: 'int-physical-sci', cannotBeUsedUntrained: true },
    { id: 'int-chemistry',       name: 'Chemistry',                   ability: 'INT', isSpecialty: true,  parent: 'int-physical-sci', cannotBeUsedUntrained: true },
    { id: 'int-physics',         name: 'Physics',                     ability: 'INT', isSpecialty: true,  parent: 'int-physical-sci', cannotBeUsedUntrained: true },
    { id: 'int-planetology',     name: 'Planetology',                 ability: 'INT', isSpecialty: true,  parent: 'int-physical-sci', cannotBeUsedUntrained: true },
    { id: 'int-security',        name: 'Security',                    ability: 'INT', isSpecialty: false, cannotBeUsedUntrained: true },
    { id: 'int-protection',      name: 'Protection',                  ability: 'INT', isSpecialty: true,  parent: 'int-security', cannotBeUsedUntrained: true },
    { id: 'int-sec-devices',     name: 'Sec. devices',                ability: 'INT', isSpecialty: true,  parent: 'int-security', cannotBeUsedUntrained: true },
    { id: 'int-system-op',       name: 'System Operation',            ability: 'INT', isSpecialty: false, cannotBeUsedUntrained: true },
    { id: 'int-communication',   name: 'Communication',               ability: 'INT', isSpecialty: true,  parent: 'int-system-op', cannotBeUsedUntrained: true },
    { id: 'int-defenses',        name: 'Defenses',                    ability: 'INT', isSpecialty: true,  parent: 'int-system-op', cannotBeUsedUntrained: true },
    { id: 'int-engineering',     name: 'Engineering',                 ability: 'INT', isSpecialty: true,  parent: 'int-system-op', cannotBeUsedUntrained: true },
    { id: 'int-sensors',         name: 'Sensors',                     ability: 'INT', isSpecialty: true,  parent: 'int-system-op', cannotBeUsedUntrained: true },
    { id: 'int-weapons-op',      name: 'Weapons',                     ability: 'INT', isSpecialty: true,  parent: 'int-system-op', cannotBeUsedUntrained: true },
    { id: 'int-tactics',         name: 'Tactics',                     ability: 'INT', isSpecialty: false, cannotBeUsedUntrained: true },
    { id: 'int-infantry',        name: 'Infantry',                    ability: 'INT', isSpecialty: true,  parent: 'int-tactics', cannotBeUsedUntrained: true },
    { id: 'int-space',           name: 'Space',                       ability: 'INT', isSpecialty: true,  parent: 'int-tactics', cannotBeUsedUntrained: true },
    { id: 'int-vehicle-tactics', name: 'Vehicle',                     ability: 'INT', isSpecialty: true,  parent: 'int-tactics', cannotBeUsedUntrained: true },
    { id: 'int-technical-sci',   name: 'Technical Science',           ability: 'INT', isSpecialty: false, cannotBeUsedUntrained: true },
    { id: 'int-invention',       name: 'Invention',                   ability: 'INT', isSpecialty: true,  parent: 'int-technical-sci', cannotBeUsedUntrained: true },
    { id: 'int-juryrig',         name: 'Juryrig',                     ability: 'INT', isSpecialty: true,  parent: 'int-technical-sci', cannotBeUsedUntrained: true },
    { id: 'int-repair',          name: 'Repair',                      ability: 'INT', isSpecialty: true,  parent: 'int-technical-sci', cannotBeUsedUntrained: true },
    { id: 'int-technical-know',  name: 'Technical know.',             ability: 'INT', isSpecialty: true,  parent: 'int-technical-sci', cannotBeUsedUntrained: true },

    // WIL Skills
    { id: 'wil-administration',  name: 'Administration',              ability: 'WIL', isSpecialty: false },
    { id: 'wil-bureaucracy',     name: 'Bureaucracy',                 ability: 'WIL', isSpecialty: true,  parent: 'wil-administration' },
    { id: 'wil-management',      name: 'Management',                  ability: 'WIL', isSpecialty: true,  parent: 'wil-administration' },
    { id: 'wil-animal-handling', name: 'Animal Handling',             ability: 'WIL', isSpecialty: false },
    { id: 'wil-animal-riding',   name: 'Animal riding',               ability: 'WIL', isSpecialty: true,  parent: 'wil-animal-handling' },
    { id: 'wil-animal-training', name: 'Animal training',             ability: 'WIL', isSpecialty: true,  parent: 'wil-animal-handling', cannotBeUsedUntrained: true },
    { id: 'wil-awareness',       name: 'Awareness',                   ability: 'WIL', isSpecialty: false },
    { id: 'wil-intuition',       name: 'Intuition',                   ability: 'WIL', isSpecialty: true,  parent: 'wil-awareness' },
    { id: 'wil-perception',      name: 'Perception',                  ability: 'WIL', isSpecialty: true,  parent: 'wil-awareness' },
    { id: 'wil-creativity',      name: 'Creativity',                  ability: 'WIL', isSpecialty: false },
    { id: 'wil-investigate',     name: 'Investigate',                 ability: 'WIL', isSpecialty: false },
    { id: 'wil-interrogate',     name: 'Interrogate',                 ability: 'WIL', isSpecialty: true,  parent: 'wil-investigate' },
    { id: 'wil-search',          name: 'Search',                      ability: 'WIL', isSpecialty: true,  parent: 'wil-investigate' },
    { id: 'wil-track',           name: 'Track',                       ability: 'WIL', isSpecialty: true,  parent: 'wil-investigate' },
    { id: 'wil-resolve',         name: 'Resolve',                     ability: 'WIL', isSpecialty: false },
    { id: 'wil-mental',          name: 'Mental',                      ability: 'WIL', isSpecialty: true,  parent: 'wil-resolve' },
    { id: 'wil-physical',        name: 'Physical',                    ability: 'WIL', isSpecialty: true,  parent: 'wil-resolve' },
    { id: 'wil-street-smart',    name: 'Street Smart',                ability: 'WIL', isSpecialty: false },
    { id: 'wil-criminal-elem',   name: 'Criminal elem.',              ability: 'WIL', isSpecialty: true,  parent: 'wil-street-smart' },
    { id: 'wil-street-know',     name: 'Street know.',                ability: 'WIL', isSpecialty: true,  parent: 'wil-street-smart' },
    { id: 'wil-teach',           name: 'Teach',                       ability: 'WIL', isSpecialty: false },

    // PER Skills
    { id: 'per-culture',         name: 'Culture',                     ability: 'PER', isSpecialty: false },
    { id: 'per-diplomacy',       name: 'Diplomacy',                   ability: 'PER', isSpecialty: true,  parent: 'per-culture' },
    { id: 'per-etiquette',       name: 'Etiquette',                   ability: 'PER', isSpecialty: true,  parent: 'per-culture' },
    { id: 'per-first-encounter', name: 'First encounter',              ability: 'PER', isSpecialty: true,  parent: 'per-culture', cannotBeUsedUntrained: true },
    { id: 'per-deception',        name: 'Deception',                  ability: 'PER', isSpecialty: false },
    { id: 'per-bluff',            name: 'Bluff',                      ability: 'PER', isSpecialty: true,  parent: 'per-deception' },
    { id: 'per-bribe',            name: 'Bribe',                      ability: 'PER', isSpecialty: true,  parent: 'per-deception' },
    { id: 'per-gamble',           name: 'Gamble',                     ability: 'PER', isSpecialty: true,  parent: 'per-deception' },
    { id: 'per-entertainment',    name: 'Entertainment',              ability: 'PER', isSpecialty: false },
    { id: 'per-act',              name: 'Act',                        ability: 'PER', isSpecialty: true,  parent: 'per-entertainment', cannotBeUsedUntrained: true },
    { id: 'per-dance',            name: 'Dance',                      ability: 'PER', isSpecialty: true,  parent: 'per-entertainment', cannotBeUsedUntrained: true },
    { id: 'per-musical-inst',     name: 'Musical inst.',              ability: 'PER', isSpecialty: true,  parent: 'per-entertainment', cannotBeUsedUntrained: true },
    { id: 'per-sing',             name: 'Sing',                       ability: 'PER', isSpecialty: true,  parent: 'per-entertainment', cannotBeUsedUntrained: true },
    { id: 'per-interaction',      name: 'Interaction',                ability: 'PER', isSpecialty: false },
    { id: 'per-bargain',          name: 'Bargain',                    ability: 'PER', isSpecialty: true,  parent: 'per-interaction' },
    { id: 'per-charm',            name: 'Charm',                      ability: 'PER', isSpecialty: true,  parent: 'per-interaction' },
    { id: 'per-interview',        name: 'Interview',                  ability: 'PER', isSpecialty: true,  parent: 'per-interaction' },
    { id: 'per-intimidate',       name: 'Intimidate',                 ability: 'PER', isSpecialty: true,  parent: 'per-interaction' },
    { id: 'per-seduce',           name: 'Seduce',                     ability: 'PER', isSpecialty: true,  parent: 'per-interaction' },
    { id: 'per-taunt',            name: 'Taunt',                      ability: 'PER', isSpecialty: true,  parent: 'per-interaction' },
    { id: 'per-leadership',       name: 'Leadership',                 ability: 'PER', isSpecialty: false },
    { id: 'per-command',          name: 'Command',                    ability: 'PER', isSpecialty: true,  parent: 'per-leadership' },
    { id: 'per-inspire',          name: 'Inspire',                    ability: 'PER', isSpecialty: true,  parent: 'per-leadership', cannotBeUsedUntrained: true },

    // Psionic Skills (Visible if Psionics is enabled)
    { id: 'con-biokinesis',      name: 'Biokinesis',                 ability: 'CON', isSpecialty: false, isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'con-bioweapon',       name: 'Bioweapon',                  ability: 'CON', isSpecialty: true,  parent: 'con-biokinesis', isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'con-control-metab',   name: 'Control metabolism',         ability: 'CON', isSpecialty: true,  parent: 'con-biokinesis', isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'con-heal',            name: 'Heal',                       ability: 'CON', isSpecialty: true,  parent: 'con-biokinesis', isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'con-morph',           name: 'Morph',                      ability: 'CON', isSpecialty: true,  parent: 'con-biokinesis', isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'con-rejuvenate',      name: 'Rejuvenate',                 ability: 'CON', isSpecialty: true,  parent: 'con-biokinesis', isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'con-transfer-dmg',    name: 'Transfer damage',            ability: 'CON', isSpecialty: true,  parent: 'con-biokinesis', isPsionic: true, cannotBeUsedUntrained: true },
    
    { id: 'int-esp',             name: 'ESP',                        ability: 'INT', isSpecialty: false, isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'int-battle-mind',     name: 'Battle mind',                ability: 'INT', isSpecialty: true,  parent: 'int-esp', isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'int-clairaudience',   name: 'Clairaudience',              ability: 'INT', isSpecialty: true,  parent: 'int-esp', isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'int-clairvoyance',    name: 'Clairvoyance',               ability: 'INT', isSpecialty: true,  parent: 'int-esp', isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'int-empathy',         name: 'Empathy',                    ability: 'INT', isSpecialty: true,  parent: 'int-esp', isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'int-mind-reading',    name: 'Mind reading',               ability: 'INT', isSpecialty: true,  parent: 'int-esp', isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'int-navcognition',    name: 'Navcognition',               ability: 'INT', isSpecialty: true,  parent: 'int-esp', isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'int-postcognition',   name: 'Postcognition',              ability: 'INT', isSpecialty: true,  parent: 'int-esp', isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'int-precognition',    name: 'Precognition',               ability: 'INT', isSpecialty: true,  parent: 'int-esp', isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'int-psychometry',     name: 'Psychometry',                ability: 'INT', isSpecialty: true,  parent: 'int-esp', isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'int-sensitivity',     name: 'Sensitivity',                ability: 'INT', isSpecialty: true,  parent: 'int-esp', isPsionic: true, cannotBeUsedUntrained: true },

    { id: 'wil-telekinesis',     name: 'Telekinesis',                ability: 'WIL', isSpecialty: false, isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'wil-electrokinetics', name: 'Electrokinetics',            ability: 'WIL', isSpecialty: true,  parent: 'wil-telekinesis', isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'wil-kinetic-shield',  name: 'Kinetic shield',             ability: 'WIL', isSpecialty: true,  parent: 'wil-telekinesis', isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'wil-levitation',      name: 'Levitation',                 ability: 'WIL', isSpecialty: true,  parent: 'wil-telekinesis', isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'wil-photokinetics',   name: 'Photokinetics',              ability: 'WIL', isSpecialty: true,  parent: 'wil-telekinesis', isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'wil-psychokinetics',  name: 'Psychokinetics',             ability: 'WIL', isSpecialty: true,  parent: 'wil-telekinesis', isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'wil-pyrokinesis',     name: 'Pyrokinesis',                ability: 'WIL', isSpecialty: true,  parent: 'wil-telekinesis', isPsionic: true, cannotBeUsedUntrained: true },

    { id: 'per-telepathy',       name: 'Telepathy',                  ability: 'PER', isSpecialty: false, isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'per-contact',         name: 'Contact',                    ability: 'PER', isSpecialty: true,  parent: 'per-telepathy', isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'per-datalink',        name: 'Datalink',                   ability: 'PER', isSpecialty: true,  parent: 'per-telepathy', isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'per-illusion',        name: 'Illusion',                   ability: 'PER', isSpecialty: true,  parent: 'per-telepathy', isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'per-mind-blast',      name: 'Mind blast',                 ability: 'PER', isSpecialty: true,  parent: 'per-telepathy', isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'per-mind-shield',     name: 'Mind shield',                ability: 'PER', isSpecialty: true,  parent: 'per-telepathy', isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'per-suggest',         name: 'Suggest',                    ability: 'PER', isSpecialty: true,  parent: 'per-telepathy', isPsionic: true, cannotBeUsedUntrained: true },
    { id: 'per-tire',            name: 'Tire',                       ability: 'PER', isSpecialty: true,  parent: 'per-telepathy', isPsionic: true, cannotBeUsedUntrained: true },
]);

/** Valid wound levels. */
const WOUND_LEVELS = Object.freeze([
    'Healthy',
    'Stunned',
    'Wounded',
    'Bleeding',
    'Down',
    'Out',
]);

/** Wound-level penalties in Steps. */
const WOUND_PENALTIES = Object.freeze({
    Healthy:  0,
    Stunned:  0, // Stuns are fleeting, usually no step penalty unless specified
    Wounded:  0, // Usually no flat penalty, but wound boxes might affect it
    Bleeding: 0,
    Down:     2,
    Out:      null,
});


// ---------------------------------------------------------------------------
// AlternityAbilitySet
// ---------------------------------------------------------------------------

class AlternityAbilitySet {
    constructor({
        id,
        name,
        type,
        isActive = false,
        triggerCondition = {},
        effectPayload = {},
    } = {}) {
        if (!id)   throw new Error('[AlternityAbilitySet] id is required.');
        if (!name) throw new Error('[AlternityAbilitySet] name is required.');
        if (!Object.values(ABILITY_TYPES).includes(type)) {
            throw new Error(`[AlternityAbilitySet] Invalid type "${type}".`);
        }

        this.id               = String(id);
        this.name             = String(name);
        this.type             = type;
        this.isActive         = Boolean(isActive);
        this.triggerCondition = triggerCondition && typeof triggerCondition === 'object' ? { ...triggerCondition } : {};
        this.effectPayload    = effectPayload && typeof effectPayload === 'object' ? { ...effectPayload } : {};
    }

    activate()   { this.isActive = true; return this; }
    deactivate() { this.isActive = false; return this; }

    serialize() {
        return {
            id:               this.id,
            name:             this.name,
            type:             this.type,
            isActive:         this.isActive,
            triggerCondition: { ...this.triggerCondition },
            effectPayload:    { ...this.effectPayload },
        };
    }

    static deserialize(data) { return new AlternityAbilitySet(data); }
}

// ---------------------------------------------------------------------------
// SpecialRuleComponent
// ---------------------------------------------------------------------------

class SpecialRuleComponent {
    constructor({ id, name, description = '', isEnabled = false, config = {} } = {}) {
        if (!id)   throw new Error('[SpecialRuleComponent] id is required.');
        if (!name) throw new Error('[SpecialRuleComponent] name is required.');
        this.id          = String(id);
        this.name        = String(name);
        this.description = String(description);
        this.isEnabled   = Boolean(isEnabled);
        this.config      = config && typeof config === 'object' ? { ...config } : {};
    }

    enable()  { this.isEnabled = true; return this; }
    disable() { this.isEnabled = false; return this; }

    serialize() {
        return { id: this.id, name: this.name, description: this.description, isEnabled: this.isEnabled, config: { ...this.config } };
    }

    static deserialize(data) { return new SpecialRuleComponent(data); }
}

// ---------------------------------------------------------------------------
// AlternityCharacterState
// ---------------------------------------------------------------------------

/**
 * Top-level state wrapper for Alternity actors.
 * Stores raw Ability Scores (4-14) and calculates Triple Skill Scores (Ordinary/Good/Amazing).
 */
class AlternityCharacterState {
    constructor({
        actorId,
        abilitySets   = [],
        specialRules  = [],
        durability    = {},
        abilityScores = {},
        skills        = {},
        customSkills  = [],
        woundLevel    = 'Healthy',
        profession    = '',
        career        = '',
        background    = '',
        actionsPerRound = 2,
        armor         = { li: 0, hi: 0, en: 0 },
        features      = null,
        psionics      = null,
        mutations     = null,
        cybertech     = null,
        computers     = null,
    } = {}) {
        if (!actorId) throw new Error('[AlternityCharacterState] actorId is required.');
        if (!WOUND_LEVELS.includes(woundLevel)) throw new Error(`[AlternityCharacterState] Invalid woundLevel "${woundLevel}".`);

        this.actorId = String(actorId);
        this.abilitySets = abilitySets.map(a => a instanceof AlternityAbilitySet ? a : AlternityAbilitySet.deserialize(a));
        this.specialRules = specialRules.map(r => r instanceof SpecialRuleComponent ? r : SpecialRuleComponent.deserialize(r));

        this.features = features || { usePsionics: false, useMutations: false, useCybertech: false };
        this.psionics = psionics || { energy: { value: 0, max: 0 }, powers: [] };
        this.mutations = mutations || { 
            origin: '', uniqueness: '', points: 0, drawbackPoints: 0, 
            ordinary: '', good: '', amazing: '', 
            slightDrawbacks: '', moderateDrawbacks: '', extremeDrawback: '' 
        };
        this.cybertech = cybertech || { tolerance: { value: 0, max: 0 }, cykosis: 0, gearInstalled: '' };
        this.computers = Array.isArray(computers) ? computers.map(c => ({ ...c })) : [];

        this.woundLevel = woundLevel;
        this.profession = String(profession);
        this.career     = String(career);
        this.background = String(background);
        this.actionsPerRound = Number(actionsPerRound);
        this.armor      = { ...armor };

        // Raw ability scores (4-14 for humans)
        this.abilityScores = {};
        for (const ab of ABILITIES) {
            this.abilityScores[ab] = Number(abilityScores[ab] ?? 10);
        }

        // Automate psionic energy max if not set
        if (this.psionics.energy.max === 0) {
            this.psionics.energy.max = this.abilityScores.WIL;
        }

        // Durability tracks (Authentic Fastplay)
        const con = this.abilityScores.CON;
        this.durability = {
            stun:       Number(durability.stun       ?? 0),
            stunMax:    con,
            wound:      Number(durability.wound      ?? 0),
            woundMax:   con,
            mortal:     Number(durability.mortal     ?? 0),
            mortalMax:  Math.ceil(con / 2),
        };

        this.skills = {};
        for (const def of SKILL_DEFINITIONS) {
            const saved = skills[def.id] || {};
            this.skills[def.id] = {
                rank:         Math.min(10, Math.max(0, Number(saved.rank ?? 0))),
                isSpecialty:  Boolean(def.isSpecialty),
            };
        }

        this.customSkills = customSkills.map(s => ({
            id:          String(s.id),
            name:        String(s.name),
            ability:     String(s.ability),
            isSpecialty: Boolean(s.isSpecialty),
            rank:        Math.min(10, Math.max(0, Number(s.rank ?? 0))),
        }));
    }

    addAbility(ability) {
        const inst = ability instanceof AlternityAbilitySet ? ability : AlternityAbilitySet.deserialize(ability);
        if (this.abilitySets.some(a => a.id === inst.id)) throw new Error(`[AlternityCharacterState] Ability with id "${inst.id}" already exists.`);
        this.abilitySets.push(inst);
        return this;
    }

    removeAbility(abilityId) {
        this.abilitySets = this.abilitySets.filter(a => a.id !== abilityId);
        return this;
    }

    addCustomSkill(skill) {
        const id = skill.id || `custom-${foundry.utils.randomID()}`;
        if (this.customSkills.some(s => s.id === id)) return this;
        this.customSkills.push({
            id,
            name:        skill.name || 'New Skill',
            ability:     skill.ability || 'STR',
            isSpecialty: Boolean(skill.isSpecialty),
            rank:        Math.min(10, Math.max(0, Number(skill.rank ?? 0))),
        });
        return this;
    }

    removeCustomSkill(skillId) {
        this.customSkills = this.customSkills.filter(s => s.id !== skillId);
        return this;
    }

    getActiveAbilities() { return this.abilitySets.filter(a => a.isActive); }
    getActiveAbilitiesByType(type) { return this.abilitySets.filter(a => a.isActive && a.type === type); }

    isSpecialRuleEnabled(ruleId) {
        const rule = this.specialRules.find(r => r.id === ruleId);
        return rule ? rule.isEnabled : false;
    }

    setSpecialRule(ruleId, enabled) {
        const rule = this.specialRules.find(r => r.id === ruleId);
        if (!rule) throw new Error(`[AlternityCharacterState] Special rule "${ruleId}" not found.`);
        enabled ? rule.enable() : rule.disable();
        return this;
    }

    /**
     * Compute the triple target numbers (Score) for a skill check.
     * Returns { ordinary, good, amazing }
     */
    getSkillScores(skillId) {
        let def = SKILL_DEFINITIONS.find(d => d.id === skillId);
        let skill = this.skills[skillId];

        // Fallback to custom skills
        if (!def) {
            def = this.customSkills.find(s => s.id === skillId);
            skill = def; // Custom skills store their rank in the same object
        }

        const abilityScore = def ? (this.abilityScores[def.ability] ?? 10) : 10;
        
        let ordinary = 0;
        if (skill && skill.rank > 0) {
            ordinary = abilityScore + skill.rank;
        } else if (def) {
            // Check if skill can be used untrained
            if (def.cannotBeUsedUntrained && (!skill || skill.rank === 0)) {
                ordinary = 0;
            } else {
                // If it's a specialty with 0 rank, use parent broad skill rank if available
                let rankToUse = 0;
                if (def.isSpecialty && def.parent) {
                    rankToUse = this.skills[def.parent]?.rank ?? 0;
                }
                ordinary = abilityScore + rankToUse;
            }
        } else {
            // Untrained (Feat check)
            ordinary = Math.floor(abilityScore / 2);
        }

        return {
            ordinary,
            good:    Math.floor(ordinary / 2),
            amazing: Math.floor(ordinary / 4),
        };
    }

    /**
     * Determine base situation step for a skill.
     * Broad Skills = +1 step (+d4), Specialty Skills = 0 steps (+d0)
     * If a specialty has 0 rank, it uses the Broad skill's base step (+1).
     */
    getSkillBaseStep(skillId) {
        let def = SKILL_DEFINITIONS.find(d => d.id === skillId);
        let skill = this.skills[skillId];

        if (!def) {
            def = this.customSkills.find(s => s.id === skillId);
            skill = def;
        }

        if (!def) return 1; // Untrained/Feat check = +1 step

        // If it's a specialty, it only gets Step 0 if the actor has at least 1 rank.
        // Otherwise, it's effectively a Broad skill roll (Step +1).
        if (def.isSpecialty) {
            return (skill && skill.rank > 0) ? 0 : 1;
        }

        return 1; // Broad skills are always Step +1
    }

    setSkillRank(skillId, rank) {
        const custom = this.customSkills.find(s => s.id === skillId);
        if (custom) {
            custom.rank = Math.min(10, Math.max(0, Math.round(Number(rank))));
            return this;
        }

        if (!this.skills[skillId]) {
            const def = SKILL_DEFINITIONS.find(d => d.id === skillId);
            if (!def) return this;
            this.skills[skillId] = { rank: 0, isSpecialty: def.isSpecialty };
        }
        this.skills[skillId].rank = Math.min(10, Math.max(0, Math.round(Number(rank))));
        return this;
    }

    setAbilityScore(ability, value) {
        if (!ABILITIES.includes(ability)) throw new Error(`[AlternityCharacterState] Unknown ability "${ability}".`);
        this.abilityScores[ability] = Math.min(14, Math.max(4, Math.round(Number(value))));
        
        // Update durability maximums
        if (ability === 'CON') {
            this.durability.stunMax = this.abilityScores.CON;
            this.durability.woundMax = this.abilityScores.CON;
            this.durability.mortalMax = Math.ceil(this.abilityScores.CON / 2);
        }

        // Update psionic energy max
        if (ability === 'WIL') {
            this.psionics.energy.max = this.abilityScores.WIL;
        }

        return this;
    }

    setWoundLevel(level) {
        if (!WOUND_LEVELS.includes(level)) throw new Error(`[AlternityCharacterState] Invalid wound level "${level}".`);
        this.woundLevel = level;
        return this;
    }

    /**
     * Total situation step penalty from damage.
     * Includes Dazed effect (+1 step per Mortal box).
     */
    getDamageStepPenalty() {
        let penalty = WOUND_PENALTIES[this.woundLevel] ?? 0;
        // Dazed effect: +1 step per Mortal box
        penalty += this.durability.mortal;
        return penalty;
    }

    /**
     * Simplified wound penalty (Wound/Down levels only).
     */
    getWoundPenalty() {
        return WOUND_PENALTIES[this.woundLevel] ?? 0;
    }

    /**
     * Apply damage and handle secondary effects.
     * Fastplay Rule: Armor reduces primary damage, but has no effect on secondary damage.
     * Secondary damage is calculated from the RAW damage before armor reduction.
     * 
     * @param {number} amount - Final mitigated primary damage.
     * @param {string} type - 'stun', 'wound', or 'mortal'.
     * @param {number|null} rawAmount - Optional raw damage for secondary calculation. 
     *                                  If null, uses 'amount'.
     */
    applyDamage(amount, type, rawAmount = null) {
        const prevWound = this.woundLevel;
        const amt = Math.max(0, Math.round(amount));
        const secondaryBasis = rawAmount !== null ? Math.max(0, Math.round(rawAmount)) : amt;

        if (type === 'stun') {
            this.durability.stun = Math.min(this.durability.stunMax, this.durability.stun + amt);
        } else if (type === 'wound') {
            this.durability.wound = Math.min(this.durability.woundMax, this.durability.wound + amt);
            // Secondary stun: 2 raw wound -> 1 stun
            const secondaryStun = Math.floor(secondaryBasis / 2);
            if (secondaryStun > 0) {
                // Apply secondary stun as a direct primary stun application (prevents infinite recursion)
                this.durability.stun = Math.min(this.durability.stunMax, this.durability.stun + secondaryStun);
            }
        } else if (type === 'mortal') {
            this.durability.mortal = Math.min(this.durability.mortalMax, this.durability.mortal + amt);
            // Secondary wound and stun: 2 raw mortal -> 1 wound + 1 stun
            const secondary = Math.floor(secondaryBasis / 2);
            if (secondary > 0) {
                // Apply secondary wound and stun directly (prevents infinite recursion)
                this.durability.wound = Math.min(this.durability.woundMax, this.durability.wound + secondary);
                this.durability.stun = Math.min(this.durability.stunMax, this.durability.stun + secondary);
            }
        }

        this._recalculateWoundLevel();
        return { woundLevelChanged: this.woundLevel !== prevWound, newWoundLevel: this.woundLevel };
    }

    _recalculateWoundLevel() {
        if (this.durability.mortal >= this.durability.mortalMax) {
            this.woundLevel = 'Out'; // Death/Mortal out
        } else if (this.durability.wound >= this.durability.woundMax || this.durability.stun >= this.durability.stunMax) {
            this.woundLevel = 'Out'; // Knockout
        } else if (this.durability.mortal > 0) {
            this.woundLevel = 'Bleeding';
        } else if (this.durability.wound > 0) {
            this.woundLevel = 'Wounded';
        } else if (this.durability.stun > 0) {
            this.woundLevel = 'Stunned';
        } else {
            this.woundLevel = 'Healthy';
        }
    }

    serialize() {
        return {
            actorId:       this.actorId,
            abilitySets:   this.abilitySets.map(a => a.serialize()),
            specialRules:  this.specialRules.map(r => r.serialize ? r.serialize() : r),
            durability:    { ...this.durability },
            abilityScores: { ...this.abilityScores },
            skills:        Object.fromEntries(Object.entries(this.skills).map(([id, s]) => [id, { rank: s.rank }])),
            customSkills:  this.customSkills.map(s => ({ ...s })),
            woundLevel:    this.woundLevel,
            profession:    this.profession,
            career:        this.career,
            background:    this.background,
            actionsPerRound: this.actionsPerRound,
            armor:         { ...this.armor },
            features:      { ...this.features },
            psionics:      { ...this.psionics },
            mutations:     { ...this.mutations },
            cybertech:     { ...this.cybertech },
            computers:     this.computers.map(c => ({ ...c })),
        };
    }

    /**
     * Get derived data for an ability, including untrained score and resistance modifier.
     */
    getAbilityData(ab) {
        if (!ABILITIES.includes(ab)) throw new Error(`[AlternityCharacterState] Unknown ability "${ab}".`);
        const score = this.abilityScores[ab];
        
        // Resistance Modifier: 11-12: +1, 13-14: +2 (Fastplay standard)
        // Only applies to STR, DEX, INT, WIL as per templates.
        let resMod = 0;
        if (['STR', 'DEX', 'INT', 'WIL'].includes(ab)) {
            if (score >= 13) resMod = 2;
            else if (score >= 11) resMod = 1;
        }

        return {
            score,
            untrained: Math.floor(score / 2),
            resMod
        };
    }

    /**
     * Calculate Action Check scores.
     * Marginal = Ordinary + 1.
     * Ordinary = floor((DEX + INT) / 2) + ProfessionBonus.
     */
    getActionCheckData() {
        const base = Math.floor((this.abilityScores.DEX + this.abilityScores.INT) / 2);
        
        let bonus = 0;
        const prof = this.profession.toLowerCase();
        if (prof.includes('combat')) bonus = 3;
        else if (prof.includes('free') || prof.includes('agent')) bonus = 2;
        else if (prof.includes('diplomat') || prof.includes('tech')) bonus = 1;

        const ordinary = base + bonus;
        const marginal = ordinary + 1;

        return {
            marginal,
            ordinary,
            good:    Math.floor(ordinary / 2),
            amazing: Math.floor(ordinary / 4)
        };
    }

    /**
     * Get actions per round.
     */
    getActionsPerRound() {
        return this.actionsPerRound || 2;
    }

    static deserialize(data) { return new AlternityCharacterState(data); }
}


const _actorStateLocks = new Map();
async function _withLock(actorId, fn) {
    if (!actorId) return fn();
    const existing = _actorStateLocks.get(actorId) || Promise.resolve();
    const next = existing.then(async () => {
        try { return await fn(); }
        finally { if (_actorStateLocks.get(actorId) === next) _actorStateLocks.delete(actorId); }
    });
    _actorStateLocks.set(actorId, next);
    return next;
}

async function getAlternityState(actor) {
    if (!actor || !actor.id) return null;
    return _withLock(actor.id, async () => {
        try {
            const raw = actor.getFlag('alternity-v2', 'characterState');
            if (raw) return AlternityCharacterState.deserialize(raw);
            const defaultState = new AlternityCharacterState({ actorId: actor.id });
            await actor.setFlag('alternity-v2', 'characterState', defaultState.serialize());
            return defaultState;
        } catch (err) { return null; }
    });
}

async function saveAlternityState(actor, state) {
    if (!actor || !actor.id || !(state instanceof AlternityCharacterState)) {
        console.error('[Alternity] saveAlternityState() called with invalid actor or state.', { actor, state });
        return false;
    }
    return _withLock(actor.id, async () => {
        try {
            const data = state.serialize();
            console.log('[Alternity] Saving state:', data);
            
            // Sync key fields back to actor.system for standard Foundry features
            const updates = {
                'flags.alternity-v2.characterState': data,
                'system.actionsPerRound': state.actionsPerRound
            };

            // Sync ability scores back to system
            for (const [ab, val] of Object.entries(state.abilityScores)) {
                updates[`system.abilities.${ab.toLowerCase()}`] = val;
            }

            await actor.update(updates);
            return true;
        } catch (err) {
            console.error(`[Alternity] saveAlternityState() failed for actor ${actor.id}:`, err);
            return false;
        }
    });
}

export {
    ABILITY_TYPES, ABILITIES, SKILL_DEFINITIONS, WOUND_LEVELS, WOUND_PENALTIES,
    AlternityAbilitySet, SpecialRuleComponent, AlternityCharacterState,
    getAlternityState, saveAlternityState,
};
