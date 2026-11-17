import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { Fieldset, Label } from './Fieldset'
import { theme, ICON } from '../shared/theme'

const PROVIDERS = [
  { id: 'ollama', label: 'Ollama', defaultPort: '11434', urlSuffix: '' },
  { id: 'lmstudio', label: 'LM Studio', defaultPort: '1234', urlSuffix: '/v1' },
]

type Step = 'provider' | 'ip' | 'port'

interface Props {
  width: number
  onConnect: (provider: string, baseURL: string) => void
  onCancel: () => void
}

const hint = (keys: string, label: string, last = false): Label[] => [
  { text: keys, color: theme.textMuted },
  { text: ` ${label}${last ? '' : '   '}`, color: theme.textFaint },
]

/** Connect to a model server: pick the server software, then address and port. */
export const ConnectPopup: React.FC<Props> = ({ width, onConnect, onCancel }) => {
  const [step, setStep] = useState<Step>('provider')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [selectedProv, setSelectedProv] = useState(PROVIDERS[0])
  const [ip, setIP] = useState('localhost')
  const [port, setPort] = useState('11434')

  useInput((_ch, key) => {
    if (step === 'provider') {
      if (key.upArrow) return setSelectedIdx((i) => Math.max(0, i - 1))
      if (key.downArrow) return setSelectedIdx((i) => Math.min(PROVIDERS.length - 1, i + 1))
      if (key.escape) return onCancel()
      if (key.return) {
        const prov = PROVIDERS[selectedIdx]
        setSelectedProv(prov)
        setIP('localhost')
        setPort(prov.defaultPort)
        setStep('ip')
      }
      return
    }
    if (step === 'ip') {
      if (key.escape) return setStep('provider')
      if (key.return) return setStep('port')
      return
    }
    if (key.escape) return setStep('ip')
    if (key.return) onConnect(selectedProv.id, `http://${ip}:${port}${selectedProv.urlSuffix}`)
  })

  const crumbs: Label[] =
    step === 'provider'
      ? [{ text: 'server software', color: theme.textFaint }]
      : [
          { text: selectedProv.label, color: theme.textMuted },
          { text: step === 'ip' ? '  address' : '  port', color: theme.textFaint },
        ]

  return (
    <Fieldset
      width={width}
      color={theme.borderSubtle}
      title={[{ text: 'connect', color: theme.primary }]}
      right={crumbs}
      footer={
        step === 'provider'
          ? [...hint('↑↓', 'select'), ...hint('enter', 'next'), ...hint('esc', 'close', true)]
          : step === 'ip'
            ? [...hint('enter', 'next'), ...hint('esc', 'back', true)]
            : [...hint('enter', 'connect'), ...hint('esc', 'back', true)]
      }
    >
      {step === 'provider' &&
        PROVIDERS.map((p, i) => {
          const sel = i === selectedIdx
          return (
            <Text key={p.id}>
              <Text color={sel ? theme.primary : theme.textGhost}>{sel ? ICON.selected : ICON.unselected}</Text>
              <Text color={sel ? theme.textBright : theme.textMuted} bold={sel}>{p.label.padEnd(12)}</Text>
              <Text color={theme.textFaint}>port {p.defaultPort}</Text>
            </Text>
          )
        })}

      {step === 'ip' && (
        <Box>
          <Text color={theme.textDim}>address  </Text>
          <Text color={theme.primary}>{ICON.caret}</Text>
          <TextInput value={ip} onChange={setIP} focus />
        </Box>
      )}

      {step === 'port' && (
        <Box>
          <Text color={theme.textDim}>port     </Text>
          <Text color={theme.primary}>{ICON.caret}</Text>
          <TextInput value={port} onChange={setPort} focus />
        </Box>
      )}
    </Fieldset>
  )
}
