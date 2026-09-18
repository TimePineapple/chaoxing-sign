import { describe, expect, it, vi } from 'vitest'
import { Cx } from './index'
import { qrCookieSnapshot, qrSetCookieNames, summarizeQrCookieChanges, summarizeQrUpstreamBody } from '~/server/utils/qrUpstreamFeedback'
import { resolveClientSignLocation } from '~/server/utils/resolveClientSignLocation'

vi.mock('~/server/utils/resolveClientSignLocation', () => ({
  resolveClientSignLocation: vi.fn(),
}))

describe('QR request location sent to Chaoxing', () => {
  it('uses the fresh browser reading for manual location sign-ins and stops when unavailable', async () => {
    const source = { latitude: 39.9, longitude: 116.4 }
    const outgoing = { text: '北京市某路 & 1号', latitude: '39.906000', longitude: '116.406000' }
    vi.mocked(resolveClientSignLocation).mockResolvedValue(outgoing)
    const signLocation = vi.fn().mockResolvedValue('签到成功')
    const cx = { preSign: vi.fn().mockResolvedValue(undefined), signLocation }
    const activity = { id: 100, otherId: 4 } as CX.ActivityDetail

    expect(await Cx.prototype.handleSign.call(cx as unknown as Cx, {} as CX.Course, activity, undefined, null))
      .toBe('浏览器定位不可用，未提交位置签到')
    expect(signLocation).not.toHaveBeenCalled()

    expect(await Cx.prototype.handleSign.call(cx as unknown as Cx, {} as CX.Course, activity, undefined, source))
      .toBe('签到成功')
    expect(resolveClientSignLocation).toHaveBeenCalledWith(source)
    expect(signLocation).toHaveBeenCalledWith(activity, outgoing)

    const stuSign = vi.fn().mockResolvedValue('签到成功')
    await Cx.prototype.signLocation.call({ user: { uid: '123', realname: '同学', schoolid: '1' }, stuSign } as unknown as Cx, activity, outgoing)
    const query = new URLSearchParams(stuSign.mock.calls[0][0])
    expect(query.get('address')).toBe(outgoing.text)
    expect(query.get('latitude')).toBe(outgoing.latitude)
    expect(query.get('longitude')).toBe(outgoing.longitude)
  })

  it('reads the QR location requirement from activity info', async () => {
    const get = vi.fn().mockResolvedValueOnce({ body: { data: { ifopenAddress: 1 } } })
      .mockResolvedValueOnce({ body: { data: { ifopenAddress: 0 } } })
      .mockResolvedValueOnce({ body: { data: { ifopenAddress: 'unexpected' } } })
      .mockResolvedValueOnce({ body: { data: {} } })
    const cx = { http: { get } }
    expect(await Cx.prototype.getQrSignLocationRequirement.call(cx as unknown as Cx, 100)).toBe(true)
    expect(await Cx.prototype.getQrSignLocationRequirement.call(cx as unknown as Cx, 100)).toBe(false)
    expect(await Cx.prototype.getQrSignLocationRequirement.call(cx as unknown as Cx, 100)).toBeUndefined()
    expect(await Cx.prototype.getQrSignLocationRequirement.call(cx as unknown as Cx, 100)).toBeUndefined()
    expect(get).toHaveBeenCalledWith('https://mobilelearn.chaoxing.com/v2/apis/active/getPPTActiveInfo', {
      searchParams: { activeId: 100 },
      signal: undefined,
    })
  })

  it('matches the successful QR location request shape and retains the missing-location fallback', async () => {
    const stuSign = vi.fn().mockResolvedValue('签到成功')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const cx = { user: { uid: '123', realname: '同学', schoolid: '1' }, deviceCode: 'fixture+device/==', stuSign }
    const activity = { id: 100 } as CX.ActivityDetail

    await Cx.prototype.signQrCode.call(cx as unknown as Cx, activity, 'fixture', 'course-1', undefined, {
      latitude: 39.9165,
      longitude: 116.4101,
      address: '北京市海淀区某路 & 1号',
    }, 'qr-fixture')
    let query = new URLSearchParams(stuSign.mock.calls[0][0])
    expect(query.get('latitude')).toBe('-1')
    expect(query.get('longitude')).toBe('-1')
    expect(query.get('courseId')).toBe('course-1')
    expect(query.get('currentFaceId')).toBe('')
    expect(query.get('ifCFP')).toBe('0')
    expect(query.get('faceEnc')).toBe('')
    expect(query.get('faceCode')).toBe('')
    expect(query.get('faceEncAid')).toBe('')
    expect(query.get('vpProbability')).toBe('1')
    expect(query.get('vpStrategy')).toBe('500')
    expect(query.get('deviceCode')).toBe('fixture+device/==')
    expect(stuSign.mock.calls[0][0]).toContain('deviceCode=fixture%2Bdevice%2F%3D%3D')
    expect(JSON.parse(query.get('location')!)).toEqual({
      result: 1,
      address: '北京市海淀区某路 & 1号',
      longitude: 116.4101,
      latitude: 39.9165,
    })
    expect(JSON.parse(query.get('locationResult')!)).toEqual({
      result: 1,
      latitude: 39.9165,
      longitude: 116.4101,
      mockData: { strategy: 500, probability: 1 },
    })
    expect(stuSign).toHaveBeenCalledWith(expect.any(String), undefined, 'qr-fixture', 'POST')
    expect(['ifTiJiao', 'useragent', 'address'].every(key => !query.has(key))).toBe(true)
    expect(info).toHaveBeenCalledWith('[qr-code-sign][qr-fixture] sign submit location fields', expect.objectContaining({
      addressPresent: false,
      nestedAddressPresent: true,
      nestedAddressNonEmpty: true,
      locationPresent: true,
      locationResultPresent: true,
    }))
    expect(info).toHaveBeenCalledWith('[qr-code-sign][qr-fixture] sign submit encoding', {
      deviceCodePreserved: true,
      locationPreserved: true,
      locationResultPreserved: true,
    })

    await Cx.prototype.signQrCode.call(cx as unknown as Cx, activity, 'fixture', 'course-1')
    query = new URLSearchParams(stuSign.mock.calls[1][0])
    expect(query.get('latitude')).toBe('-1')
    expect(query.get('longitude')).toBe('-1')
    expect(query.has('location')).toBe(false)
    expect(query.has('locationResult')).toBe(false)
    expect(stuSign).toHaveBeenLastCalledWith(expect.any(String), undefined, undefined, 'GET')
    info.mockRestore()
  })

  it('records available HTTP feedback while hiding URLs and coordinates', async () => {
    const get = vi.fn().mockResolvedValue({
      body: 'locationAuthError_LCR007',
      statusCode: 200,
      headers: { 'content-type': 'text/plain; charset=UTF-8' },
    })
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const cx = { http: { get } }

    expect(await Cx.prototype.stuSign.call(cx as unknown as Cx, 'fixture-query', undefined, 'qr-fixture')).toBe('locationAuthError_LCR007')
    expect(info).toHaveBeenCalledWith('[qr-code-sign][qr-fixture] upstream HTTP response', {
      status: 200,
      contentType: 'text/plain; charset=UTF-8',
      bodyLength: 24,
      bodyPreview: 'locationAuthError_LCR007',
    })
    expect(summarizeQrUpstreamBody('https://example.com/?uid=123')).toMatchObject({
      bodyPreview: '[非简短文本响应已隐藏]',
    })
    expect(summarizeQrUpstreamBody('位置 39.908823,116.39747')).toMatchObject({
      bodyPreview: '位置 [坐标已隐藏],[坐标已隐藏]',
    })
    info.mockRestore()
  })

  it('posts location QR fields as UTF-8 form data and keeps plain sign-ins on GET', async () => {
    const get = vi.fn().mockResolvedValue({ body: 'success', statusCode: 200, headers: {} })
    const post = vi.fn().mockResolvedValue({ body: 'success', statusCode: 200, headers: {} })
    const cx = { http: { get, post } }

    expect(await Cx.prototype.stuSign.call(cx as unknown as Cx, 'location=%7B%7D', undefined, undefined, 'POST')).toBe('签到成功')
    expect(post).toHaveBeenCalledWith('https://mobilelearn.chaoxing.com/pptSign/stuSignajax', {
      body: 'location=%7B%7D',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
        origin: 'https://mobilelearn.chaoxing.com',
      },
      responseType: 'text',
      signal: undefined,
    })
    expect(get).not.toHaveBeenCalled()

    expect(await Cx.prototype.stuSign.call(cx as unknown as Cx, 'activeId=1')).toBe('签到成功')
    expect(get).toHaveBeenCalledWith('https://mobilelearn.chaoxing.com/pptSign/stuSignajax', {
      searchParams: 'activeId=1',
      responseType: 'text',
      signal: undefined,
    })
  })

  it('reports cookie names and changes without exposing cookie values', () => {
    const before = new Map([['existing', 'secret-old']])
    const after = new Map([['existing', 'secret-new'], ['new_cookie', 'secret-added']])
    expect(summarizeQrCookieChanges(before, after)).toEqual({
      cookieNamesBefore: ['existing'],
      cookieNamesAfter: ['existing', 'new_cookie'],
      addedCookieNames: ['new_cookie'],
      updatedCookieNames: ['existing'],
    })
    expect(qrSetCookieNames(['session=very-secret; Path=/', 'new_cookie=other-secret; HttpOnly'])).toEqual(['new_cookie', 'session'])
    expect(qrCookieSnapshot(undefined, 'https://mobilelearn.chaoxing.com')).toEqual(new Map())
  })

  it('distinguishes an empty pre-sign status from an HTTP failure', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({
        body: '<div id="statuscontent"></div>',
        statusCode: 200,
        headers: { 'content-type': 'text/html', 'set-cookie': ['session=very-secret; Path=/'] },
        redirectUrls: [],
      })
      .mockResolvedValueOnce({ body: "code='+'abc123'", statusCode: 200, headers: { 'content-type': 'text/html' }, redirectUrls: [] })
      .mockResolvedValueOnce({ body: 'ok', statusCode: 200, headers: { 'content-type': 'text/plain' }, redirectUrls: [] })
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const cx = { http: { get }, user: { uid: '123' } }

    expect(await Cx.prototype.preSign.call(cx as unknown as Cx, { courseId: '1', classId: '2' } as CX.Course, { id: 3 } as CX.ActivityDetail, undefined, 'qr-fixture')).toBeUndefined()
    expect(info).toHaveBeenCalledWith('[qr-code-sign][qr-fixture] pre-sign request', expect.objectContaining({
      courseIdPresent: true,
      classIdPresent: true,
      activePrimaryIdPresent: true,
      uidPresent: true,
      utPresent: false,
    }))
    expect(get).toHaveBeenCalledWith('https://mobilelearn.chaoxing.com/newsign/preSign', expect.objectContaining({
      searchParams: expect.objectContaining({ courseId: '1', classId: '2', activePrimaryId: 3, uid: '123' }),
    }))
    expect(info).toHaveBeenCalledWith('[qr-code-sign][qr-fixture] pre-sign HTTP response', expect.objectContaining({
      status: 200,
      statusElementPresent: true,
      setCookieNames: ['session'],
    }))
    expect(info).toHaveBeenCalledWith('[qr-code-sign][qr-fixture] analysis HTTP response', expect.objectContaining({ codePresent: true }))
    expect(JSON.stringify(info.mock.calls)).not.toContain('very-secret')
    info.mockRestore()
  })
})
