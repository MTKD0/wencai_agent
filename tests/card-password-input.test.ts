// @vitest-environment jsdom
import { createElement, Fragment, useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CardPasswordInput, CardPasswordKeypad } from '#/components/ui/CardPasswordInput'

afterEach(cleanup)

it('H5 uses a read-only field and the bank keypad for entry, deletion and visibility', () => {
  const activate = vi.fn()
  function Password() {
    const [value, setValue] = useState('')
    return createElement(Fragment, null,
      createElement(CardPasswordInput, { id: 'password', label: '交易密码', value, onChange: setValue, onActivate: activate, disabled: false }),
      createElement(CardPasswordKeypad, { onDigit: digit => setValue(value => (value + digit).slice(0, 6)), onDelete: () => setValue(value => value.slice(0, -1)), onHide: () => {}, disabled: false }))
  }
  render(createElement(Password))
  const input = screen.getByLabelText('交易密码') as HTMLInputElement
  expect(input.readOnly).toBe(true)
  expect(input.inputMode).toBe('none')
  fireEvent.pointerDown(input)
  expect(activate).toHaveBeenCalled()
  expect(document.activeElement).toBe(input)
  for (const digit of ['1', '2', '3', '4', '5', '6', '7']) fireEvent.click(screen.getByRole('button', { name: digit }))
  expect(input.value).toBe('123456')
  fireEvent.click(screen.getByRole('button', { name: '删除一位密码' }))
  expect(input.value).toBe('12345')
  fireEvent.click(screen.getByRole('button', { name: '显示交易密码' }))
  expect(input.type).toBe('text')
  expect(input.readOnly).toBe(true)
})

it('desktop retains physical keyboard entry and digit filtering', () => {
  const change = vi.fn()
  render(createElement(CardPasswordInput, { id: 'desktop-password', label: '交易密码', value: '', onChange: change, onActivate: () => {}, disabled: false, segmented: true }))
  const input = screen.getByLabelText('交易密码') as HTMLInputElement
  expect(input.readOnly).toBe(false)
  expect(input.inputMode).toBe('numeric')
  fireEvent.change(input, { target: { value: '12a34567' } })
  expect(change).toHaveBeenCalledWith('123456')
})
