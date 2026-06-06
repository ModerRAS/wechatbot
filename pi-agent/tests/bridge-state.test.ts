import { describe, expect, it } from 'vitest'

import {
  applyCommand,
  createBridgeState,
  createHistoryEntry,
  getHistoryEntryByGlobalId,
  getRouteLabel,
  isEditableHistoryEntry,
} from '../src/bridge-state.js'

describe('bridge state machine', () => {
  it('starts in steer idle state', () => {
    const state = createBridgeState()

    expect(state.routeMode).toBe('steer')
    expect(state.uiState).toEqual({ type: 'idle' })
  })

  it('switches between steer and follow-up modes', () => {
    const state = createBridgeState()

    expect(applyCommand(state, '/followup').message).toContain('follow-up')
    expect(state.routeMode).toBe('followUp')

    expect(applyCommand(state, '/steer').message).toContain('steer')
    expect(state.routeMode).toBe('steer')
  })

  it('keeps a unified history log with per-mode ordinals', () => {
    const state = createBridgeState()

    const first = createHistoryEntry(state, 'steer', 'Keep replies short and direct.')
    const second = createHistoryEntry(state, 'followUp', 'Continue with the deployment steps.')
    const third = createHistoryEntry(state, 'steer', 'Prefer diffs over prose.')

    expect(first).toMatchObject({ globalId: 1, mode: 'steer', modeOrdinal: 1 })
    expect(second).toMatchObject({ globalId: 2, mode: 'followUp', modeOrdinal: 1 })
    expect(third).toMatchObject({ globalId: 3, mode: 'steer', modeOrdinal: 2 })
  })

  it('opens history by global id and enters edit state', () => {
    const state = createBridgeState()
    const entry = createHistoryEntry(state, 'followUp', 'Continue and focus on error handling.')

    applyCommand(state, '/history')
    const result = applyCommand(state, `/open ${entry.globalId}`)

    expect(result.message).toContain('修订版')
    expect(state.uiState).toEqual({
      type: 'historyEdit',
      globalId: entry.globalId,
      returnMode: 'steer',
    })
  })

  it('returns the full history item for editing lookups', () => {
    const state = createBridgeState()
    const entry = createHistoryEntry(state, 'steer', 'Keep replies concise but preserve exact commands.')

    expect(getHistoryEntryByGlobalId(state, entry.globalId)).toEqual(entry)
  })

  it('marks only plain text history as editable', () => {
    const state = createBridgeState()
    const editable = createHistoryEntry(state, 'steer', 'This is editable text.')
    const nonEditable = createHistoryEntry(state, 'followUp', '[image]', {
      editable: false,
      sourceType: 'image',
    })

    expect(isEditableHistoryEntry(editable)).toBe(true)
    expect(isEditableHistoryEntry(nonEditable)).toBe(false)
  })

  it('formats route labels for unified history display', () => {
    expect(getRouteLabel('steer', 6)).toBe('S#6')
    expect(getRouteLabel('followUp', 5)).toBe('F#5')
  })
})
