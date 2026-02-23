import { describe, expect, it, vi } from 'vitest'
import { agentLog, agentWarn, agentError } from './agent-logger'

describe('agent-logger', () => {
  describe('agentLog', () => {
    it('logs a message with timestamp prefix', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
      agentLog('test message')
      expect(spy).toHaveBeenCalledOnce()
      expect(spy.mock.calls[0]![0]).toMatch(/\[.*\] \[Agent\] test message/)
      spy.mockRestore()
    })

    it('logs message with metadata', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const meta = { foo: 'bar' }
      agentLog('with meta', meta)
      expect(spy).toHaveBeenCalledOnce()
      expect(spy.mock.calls[0]![0]).toMatch(/\[Agent\] with meta/)
      expect(spy.mock.calls[0]![1]).toEqual(meta)
      spy.mockRestore()
    })
  })

  describe('agentWarn', () => {
    it('warns with timestamp prefix', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      agentWarn('warning msg')
      expect(spy).toHaveBeenCalledOnce()
      expect(spy.mock.calls[0]![0]).toMatch(/\[Agent\] warning msg/)
      spy.mockRestore()
    })

    it('warns with metadata', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      agentWarn('meta warn', { detail: 42 })
      expect(spy).toHaveBeenCalledOnce()
      expect(spy.mock.calls[0]![1]).toEqual({ detail: 42 })
      spy.mockRestore()
    })
  })

  describe('agentError', () => {
    it('logs error with prefix', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      agentError('fail')
      expect(spy).toHaveBeenCalledOnce()
      expect(spy.mock.calls[0]![0]).toMatch(/\[Agent\] fail/)
      spy.mockRestore()
    })

    it('logs error with error object', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const err = new Error('oops')
      agentError('something broke', err)
      expect(spy).toHaveBeenCalledOnce()
      expect(spy.mock.calls[0]![1]).toBe(err)
      spy.mockRestore()
    })

    it('logs error with both error and metadata', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const err = new Error('oops')
      const meta = { context: 'test' }
      agentError('broke with meta', err, meta)
      expect(spy).toHaveBeenCalledOnce()
      expect(spy.mock.calls[0]![1]).toEqual(meta)
      expect(spy.mock.calls[0]![2]).toBe(err)
      spy.mockRestore()
    })
  })
})
