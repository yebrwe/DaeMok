#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function parse(relativePath) {
  return ts.createSourceFile(
    relativePath,
    read(relativePath),
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function findDeclaration(sourceFile, name, predicate) {
  let match = null;
  walk(sourceFile, (node) => {
    if (!match && predicate(node) && node.name?.text === name) match = node;
  });
  return match;
}

function identifiersIn(node) {
  const identifiers = new Set();
  walk(node, (child) => {
    if (ts.isIdentifier(child)) identifiers.add(child.text);
  });
  return identifiers;
}

function literalTextsIn(node) {
  const values = [];
  walk(node, (child) => {
    if (ts.isStringLiteralLike(child) || ts.isTemplateHead(child)
      || ts.isTemplateMiddle(child) || ts.isTemplateTail(child)) {
      values.push(child.text);
    }
  });
  return values;
}

function importsFrom(sourceFile, moduleName) {
  return sourceFile.statements.filter((statement) => (
    ts.isImportDeclaration(statement)
      && ts.isStringLiteral(statement.moduleSpecifier)
      && statement.moduleSpecifier.text === moduleName
  ));
}

function namedImportNames(declaration) {
  const bindings = declaration.importClause?.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return [];
  return bindings.elements.map((element) => element.name.text).sort();
}

function arrayStringValues(sourceFile, name) {
  const declaration = findDeclaration(
    sourceFile,
    name,
    (node) => ts.isVariableDeclaration(node),
  );
  assert.ok(declaration, `${name} must remain an explicit UI catalog`);
  assert.ok(ts.isArrayLiteralExpression(declaration.initializer), `${name} must remain an array literal`);
  return declaration.initializer.elements.map((element) => {
    assert.ok(ts.isStringLiteralLike(element), `${name} entries must be string literals`);
    return element.text;
  });
}

const authorityFiles = [
  'src/components/AuthorityGameRoom.tsx',
  'src/hooks/useMazeAuthority.ts',
  'src/lib/mazeAuthorityClient.ts',
  'src/lib/mazeAuthorityPresentation.ts',
  'src/lib/mazeAuthorityRuntime.ts',
];
const authoritySources = authorityFiles.map((relativePath) => ({
  relativePath,
  sourceFile: parse(relativePath),
}));

const forbiddenLegacyRoots = ['rooms', 'userRooms', 'userStatus'];
const forbiddenLegacyModules = new Set([
  '@/components/GamePlay',
  '@/components/GameRoom',
  '@/hooks/useFirebase',
  '@/hooks/useRoomPresence',
  '@/lib/mazeRankingFirebase',
]);

for (const { relativePath, sourceFile } of authoritySources) {
  const identifiers = identifiersIn(sourceFile);
  assert.equal(
    identifiers.has('resolveTurnAction'),
    false,
    `${relativePath} must send turn intent instead of resolving turns locally`,
  );
  assert.equal(
    identifiers.has('buildMazeAuthorityForfeitCommand'),
    false,
    `${relativePath} must not expose the retired voluntary-forfeit builder`,
  );

  for (const literal of literalTextsIn(sourceFile)) {
    assert.equal(
      forbiddenLegacyRoots.some((root) => literal === root || literal.startsWith(`${root}/`)),
      false,
      `${relativePath} must not address a legacy RTDB root (${literal})`,
    );
  }

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    assert.equal(
      forbiddenLegacyModules.has(statement.moduleSpecifier.text),
      false,
      `${relativePath} must not import ${statement.moduleSpecifier.text}`,
    );
  }

  for (const firebaseImport of importsFrom(sourceFile, '@/lib/firebase')) {
    assert.deepEqual(
      namedImportNames(firebaseImport),
      ['firebaseInitPromise'],
      `${relativePath} may use the shared Firebase initializer but no legacy room helper`,
    );
  }
}

const authorityRoomPath = 'src/components/AuthorityGameRoom.tsx';
const authorityRoomSource = read(authorityRoomPath);
assert.doesNotMatch(
  authorityRoomSource,
  /(?:기권|포기)/u,
  'AuthorityGameRoom must not render a voluntary-forfeit control or message',
);
assert.doesNotMatch(
  authorityRoomSource,
  /from\s+['"]firebase\/database['"]/u,
  'AuthorityGameRoom must not directly mutate RTDB',
);
const authorityRoomSourceFile = parse(authorityRoomPath);
const leaveHandler = findDeclaration(
  authorityRoomSourceFile,
  'leave',
  (node) => ts.isVariableDeclaration(node),
);
assert.ok(leaveHandler, 'AuthorityGameRoom must keep an explicit leave handler');
assert.match(
  leaveHandler.getText(authorityRoomSourceFile),
  /if\s*\(phase\s*===\s*['"]play['"]\)[\s\S]*?return;/u,
  'AuthorityGameRoom must reject leave before sending a command during play',
);
const leaveDisabled = findDeclaration(
  authorityRoomSourceFile,
  'leaveDisabled',
  (node) => ts.isVariableDeclaration(node),
);
assert.ok(leaveDisabled, 'AuthorityGameRoom must expose an explicit leave-disabled state');
assert.match(
  leaveDisabled.getText(authorityRoomSourceFile),
  /phase\s*===\s*['"]play['"]\s*&&\s*isMember/u,
  'AuthorityGameRoom must disable participant leave throughout play',
);
assert.match(
  authorityRoomSource,
  /disabled=\{leaveDisabled\}/u,
  'the Authority leave control must consume the play-phase disabled state',
);

const clientPath = 'src/lib/mazeAuthorityClient.ts';
const clientSourceFile = parse(clientPath);
assert.equal(
  findDeclaration(clientSourceFile, 'MazeAuthorityForfeitCommand', ts.isInterfaceDeclaration),
  null,
  'the public client contract must not define a voluntary-forfeit command',
);
assert.equal(
  findDeclaration(clientSourceFile, 'buildMazeAuthorityForfeitCommand', ts.isFunctionDeclaration),
  null,
  'the public client contract must not export a voluntary-forfeit builder',
);
const commandParser = findDeclaration(
  clientSourceFile,
  'parseMazeAuthorityCommand',
  ts.isFunctionDeclaration,
);
assert.ok(commandParser, 'parseMazeAuthorityCommand must exist');
assert.equal(
  literalTextsIn(commandParser).includes('forfeit'),
  false,
  'the public command parser must reject voluntary forfeit',
);

const routePath = 'src/app/rooms/[id]/page.tsx';
const routeSourceFile = parse(routePath);
const authorityRoute = findDeclaration(routeSourceFile, 'AuthorityRoomPage', ts.isFunctionDeclaration);
assert.ok(authorityRoute, 'the room route must keep an isolated AuthorityRoomPage');
const authorityRouteIdentifiers = identifiersIn(authorityRoute);
for (const legacyIdentifier of ['GameRoom', 'useRoomPresence', 'getDatabase', 'runTransaction', 'update']) {
  assert.equal(
    authorityRouteIdentifiers.has(legacyIdentifier),
    false,
    `AuthorityRoomPage must not use legacy symbol ${legacyIdentifier}`,
  );
}
for (const literal of literalTextsIn(authorityRoute)) {
  assert.equal(
    forbiddenLegacyRoots.some((root) => literal === root || literal.startsWith(`${root}/`)),
    false,
    `AuthorityRoomPage must not address a legacy RTDB root (${literal})`,
  );
}

const setupPath = 'src/components/GameSetup.tsx';
const setupSource = read(setupPath);
const setupSourceFile = parse(setupPath);
const newMapCatalog = [
  ...arrayStringValues(setupSourceFile, 'TRAP_ITEMS'),
  ...arrayStringValues(setupSourceFile, 'SPECIAL_WALL_ITEMS'),
];
const paletteItems = findDeclaration(
  setupSourceFile,
  'paletteItems',
  (node) => ts.isVariableDeclaration(node),
);
assert.ok(paletteItems, 'GameSetup must derive the rendered new-map palette explicitly');
const paletteIdentifiers = identifiersIn(paletteItems);
assert.equal(paletteIdentifiers.has('TRAP_ITEMS'), true, 'the trap catalog must feed the rendered palette');
assert.equal(
  paletteIdentifiers.has('SPECIAL_WALL_ITEMS'),
  true,
  'the supported-wall catalog must feed the rendered palette',
);
assert.match(setupSource, /paletteItems\.map\(/u, 'GameSetup must render the guarded palette catalog');
const retiredEditorTypes = [
  'radar',
  'steelWall',
  'collapseWall',
  'phaseWall',
  'mirrorWall',
  'crystalWall',
];
assert.deepEqual(
  new Set(arrayStringValues(setupSourceFile, 'RETIRED_EDITOR_ITEM_TYPES')),
  new Set(retiredEditorTypes),
  'restored drafts must use the complete retired-item catalog',
);
assert.match(
  setupSource,
  /!RETIRED_EDITOR_ITEM_TYPES\.includes\(item\.type\)/u,
  'restored drafts must strip the retired-item catalog before editing',
);
assert.deepEqual(
  new Set(arrayStringValues(setupSourceFile, 'RETIRED_WALLS_TO_ORDINARY')),
  new Set(['steelWall', 'phaseWall', 'crystalWall']),
  'retired wall-only items must preserve their segment as ordinary walls',
);
for (const retiredType of retiredEditorTypes) {
  assert.equal(
    newMapCatalog.includes(retiredType),
    false,
    `${retiredType} must not be exposed in the new-map palette`,
  );
}

const retiredTypes = findDeclaration(
  clientSourceFile,
  'RETIRED_NEW_MAP_ITEM_TYPES',
  (node) => ts.isVariableDeclaration(node),
);
assert.ok(retiredTypes, 'the Authority submit boundary must declare retired map types');
assert.deepEqual(
  new Set(literalTextsIn(retiredTypes)),
  new Set([
    'radar',
    'steelWall',
    'collapseWall',
    'phaseWall',
    'mirrorWall',
    'crystalWall',
  ]),
  'the complete retired item catalog is rejected from new submissions',
);
const submittedMapParser = findDeclaration(
  clientSourceFile,
  'parseSubmittedGameMap',
  ts.isFunctionDeclaration,
);
assert.ok(submittedMapParser, 'parseSubmittedGameMap must exist');
const mapItemParser = findDeclaration(
  clientSourceFile,
  'parseMapItem',
  ts.isFunctionDeclaration,
);
assert.ok(mapItemParser, 'parseMapItem must exist');
assert.equal(
  identifiersIn(mapItemParser).has('NEW_MAP_ITEM_TYPES'),
  true,
  'the item decoder must provide the reduced new-map catalog',
);
const submittedMapParserSource = submittedMapParser.getText(clientSourceFile);
assert.match(
  submittedMapParserSource,
  /value\.skillLoadout\s*!==\s*NEW_MAP_SKILL_LOADOUT/u,
  'Authority submissions must reject every retired skill loadout on the wire',
);
assert.match(
  submittedMapParserSource,
  /parseMapItemList\(value\.items,\s*false\)/u,
  'Authority item-list submission must disable retired-type compatibility decoding',
);
assert.match(
  submittedMapParserSource,
  /parseMapItem\(value\.item,\s*false\)/u,
  'Authority single-item submission must disable retired-type compatibility decoding',
);
const submitBuilder = findDeclaration(
  clientSourceFile,
  'buildMazeAuthoritySubmitMapCommand',
  ts.isFunctionDeclaration,
);
assert.ok(submitBuilder, 'buildMazeAuthoritySubmitMapCommand must exist');
assert.match(
  submitBuilder.getText(clientSourceFile),
  /skillLoadout:\s*NEW_MAP_SKILL_LOADOUT/u,
  'the client builder must normalize stale draft loadouts to the compatibility value',
);

const legacyFirebasePath = 'src/lib/firebase.ts';
const legacyFirebaseSourceFile = parse(legacyFirebasePath);
const legacyStartGame = findDeclaration(
  legacyFirebaseSourceFile,
  'startGame',
  (node) => ts.isVariableDeclaration(node),
);
assert.ok(legacyStartGame, 'the legacy room adapter must keep an explicit startGame boundary');
const legacyStartGameSource = legacyStartGame.getText(legacyFirebaseSourceFile);
assert.equal(
  identifiersIn(legacyStartGame).has('createMazeSkillState'),
  false,
  'legacy room startup must not initialize retired skill state',
);
assert.doesNotMatch(
  legacyStartGameSource,
  /mazeSkill/u,
  'legacy room startup must not write a mazeSkill payload',
);
assert.match(
  legacyStartGameSource,
  /delete\s+persistentState\.itemState/u,
  'legacy room startup must discard stale setup item/skill state',
);

console.log(
  'MAZE AUTHORITY CLIENT CONTRACT: no legacy writes/local resolution/voluntary forfeit; retired items stay out of new maps',
);
