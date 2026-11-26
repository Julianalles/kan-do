import { describe, expect, it } from 'vitest'
import { isUsableOrigin, keepInside, placeSheet, SHEET_MARGIN, SHEET_MAX_WIDTH, sheetHeight, sheetMaxHeight, sheetWidth } from '~/utils/sheetPlacement'

const viewport = { width: 1280, height: 800 }
const card = { x: 500, y: 300, w: 288, h: 132 }

describe('sheetPlacement', () => {
  it('is 720 px wide, or the window minus the margins when narrower', () => {
    expect(sheetWidth(1280)).toBe(SHEET_MAX_WIDTH)
    expect(sheetWidth(752)).toBe(720)
    expect(sheetWidth(751)).toBe(719)
    expect(sheetWidth(768)).toBe(720)
    expect(sheetWidth(20)).toBe(0)
  })

  it('is at most the window height minus the margins', () => {
    expect(sheetMaxHeight(800)).toBe(768)
    expect(sheetMaxHeight(10)).toBe(0)
  })

  it('has one frame height that follows the width, or the window when that is shorter (#870)', () => {
    expect(sheetHeight(720, 728)).toBe(403)
    expect(sheetHeight(720, 1000)).toBe(403)
    expect(sheetHeight(720, 300)).toBe(300)
    expect(sheetHeight(568, 728)).toBe(318)
    expect(sheetHeight(0, 0)).toBe(0)
  })

  it('centres the sheet on the card', () => {
    const box = placeSheet(card, { w: 720, h: 384 }, viewport)
    expect(box.x + box.w / 2).toBe(card.x + card.w / 2)
    expect(box.y + box.h / 2).toBe(card.y + card.h / 2)
  })

  it('keeps 16 px to every edge for a card at an edge', () => {
    const right = placeSheet({ x: 1000, y: 700, w: 288, h: 132 }, { w: 720, h: 384 }, viewport)
    expect(right.x + right.w).toBe(viewport.width - SHEET_MARGIN)
    expect(right.y + right.h).toBe(viewport.height - SHEET_MARGIN)
    const left = placeSheet({ x: 0, y: 0, w: 288, h: 132 }, { w: 720, h: 384 }, viewport)
    expect(left).toMatchObject({ x: SHEET_MARGIN, y: SHEET_MARGIN })
  })

  it('centres in the window when there is no origin card', () => {
    expect(placeSheet(null, { w: 720, h: 400 }, viewport)).toEqual({ x: 280, y: 200, w: 720, h: 400 })
  })

  it('pins a sheet that does not fit to the top left margin instead of pushing it out', () => {
    const box = placeSheet(card, { w: 720, h: 900 }, { width: 700, height: 800 })
    expect(box).toMatchObject({ x: SHEET_MARGIN, y: SHEET_MARGIN })
  })

  it('moves a grown sheet back inside without touching its size', () => {
    const box = keepInside({ x: 100, y: 500, w: 720, h: 500 }, viewport)
    expect(box).toEqual({ x: 100, y: 284, w: 720, h: 500 })
  })

  it('keeps the sheet below the app bar when a top inset is given (#518)', () => {
    const bar = { ...viewport, top: 56 }
    expect(placeSheet({ x: 0, y: 0, w: 288, h: 132 }, { w: 720, h: 384 }, bar)).toMatchObject({ x: SHEET_MARGIN, y: 56 })
    // a card low in the window opens where it did without the inset
    expect(placeSheet(card, { w: 720, h: 384 }, bar)).toEqual(placeSheet(card, { w: 720, h: 384 }, viewport))
    // the bottom margin still holds
    expect(placeSheet({ x: 1000, y: 700, w: 288, h: 132 }, { w: 720, h: 384 }, bar).y).toBe(800 - 384 - SHEET_MARGIN)
    // a grown sheet is moved back below the bar, not above it
    expect(keepInside({ x: 100, y: 20, w: 720, h: 500 }, bar)).toEqual({ x: 100, y: 56, w: 720, h: 500 })
  })

  it('leaves the window height minus the top inset and the bottom margin to the sheet (#518)', () => {
    expect(sheetMaxHeight(800, 56)).toBe(728)
    expect(sheetMaxHeight(800, 0)).toBe(768)
    expect(sheetMaxHeight(800)).toBe(768)
    expect(sheetMaxHeight(40, 56)).toBe(0)
  })

  it('takes a card as the origin only while it has a size and shows in the window', () => {
    expect(isUsableOrigin(card, viewport)).toBe(true)
    expect(isUsableOrigin({ x: 1200, y: 780, w: 288, h: 132 }, viewport)).toBe(true)
    expect(isUsableOrigin({ x: 500, y: 900, w: 288, h: 132 }, viewport)).toBe(false)
    expect(isUsableOrigin({ x: 500, y: -200, w: 288, h: 132 }, viewport)).toBe(false)
    expect(isUsableOrigin({ x: 0, y: 0, w: 0, h: 0 }, viewport)).toBe(false)
    expect(isUsableOrigin(null, viewport)).toBe(false)
  })
})
