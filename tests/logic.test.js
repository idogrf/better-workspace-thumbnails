// SPDX-License-Identifier: GPL-2.0-or-later
import {check, finish} from './assert.js';
import {nearestIndex, slotShifts, workspaceLabel} from '../logic.js';

const names = ['Main', '  ', 'Gantry'];
check('named workspace', workspaceLabel(names, 0) === 'Main');
check('blank name falls back', workspaceLabel(names, 1) === 'Workspace 2');
check('name is trimmed', workspaceLabel([' Mail '], 0) === 'Mail');
check('beyond the list falls back', workspaceLabel(names, 4) === 'Workspace 5');

const centers = [50, 150, 250];
check('on a center', nearestIndex(centers, 150) === 1);
check('in a gap goes to the closer', nearestIndex(centers, 190) === 1);
check('past the start', nearestIndex(centers, -40) === 0);
check('past the end', nearestIndex(centers, 900) === 2);
check('no slots', nearestIndex([], 10) === -1);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check('drag right closes up leftward', same(slotShifts(4, 0, 2), [2, -1, -1, 0]));
check('drag left closes up rightward', same(slotShifts(4, 3, 1), [0, 1, 1, -2]));
check('no move, no shift', same(slotShifts(3, 1, 1), [0, 0, 0]));

finish();
