// SPDX-License-Identifier: GPL-2.0-or-later
// Pure helpers for the thumbnail labels and the reorder drop target. Free of
// GNOME imports so the unit tests can run them with plain gjs.

/**
 * Returns the label for a workspace.
 *
 * @param {string[]} names - The `workspace-names` setting; may be shorter
 *   than the number of workspaces, and may contain blank entries.
 * @param {number} index - 0-based workspace index.
 * @returns {string} The workspace's name, or "Workspace N" when it has none.
 */
export function workspaceLabel(names, index) {
    const name = (names[index] ?? '').trim();
    return name || `Workspace ${index + 1}`;
}

/**
 * Picks the slot whose center is nearest to `x`.
 *
 * Every point maps to a slot, so a drop in the gap between two thumbnails
 * still lands on the closer one.
 *
 * @param {number[]} centers - Horizontal center of each slot, in order.
 * @param {number} x - Pointer position, in the same coordinates.
 * @returns {number} Index into `centers`, or -1 when it is empty.
 */
export function nearestIndex(centers, x) {
    let best = -1;
    let bestDistance = Infinity;
    centers.forEach((center, i) => {
        const distance = Math.abs(x - center);
        if (distance < bestDistance) {
            best = i;
            bestDistance = distance;
        }
    });
    return best;
}

/**
 * Returns how many slots each thumbnail moves while one is dragged.
 *
 * The dragged thumbnail's slot becomes a gap at the drop position: the ones
 * between it and the target close up by one slot toward where it was. The
 * dragged one gets the full distance, which is where its outline goes.
 *
 * @param {number} count - Number of thumbnails.
 * @param {number} from - Index of the dragged thumbnail.
 * @param {number} to - Index it would be dropped at.
 * @returns {number[]} Slot offset per thumbnail, negative to the left.
 */
export function slotShifts(count, from, to) {
    const shifts = new Array(count).fill(0);
    for (let i = 0; i < count; i++) {
        if (i === from)
            shifts[i] = to - from;
        else if (from < i && i <= to)
            shifts[i] = -1;
        else if (to <= i && i < from)
            shifts[i] = 1;
    }
    return shifts;
}
