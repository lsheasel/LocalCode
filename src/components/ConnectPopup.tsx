import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'

const PROVIDERS = [
  { id: 'ollama',    label: 'Ollama',    defaultPort: '11434', urlSuffix: ''    },
  { id: 'lmstudio', label: 'LM Studio', defaultPort: '1234',  urlSuffix: '/v1' },
]

type Step = 'provider' | 'ip' | 'port'

interface Props {
  onConnect: (provider: string, baseURL: string) => void
  onCancel: () => void
}

export const ConnectPopup: React.FC<Props> = ({ onConnect, onCancel }) => {
  const [step, setStep]                 = useState<Step>('provider')
  const [search, setSearch]             = useState('')
  const [selectedIdx, setSelectedIdx]   = useState(0)
  const [selectedProv, setSelectedProv] = useState(PROVIDERS[0])
  const [ip, setIP]                     = useState('localhost')
  const [port, setPort]                 = useState('11434')

  const filtered = PROVIDERS.filter(p =>
    p.label.toLowerCase().includes(search.toLowerCase()) ||
    p.id.toLowerCase().includes(search.toLowerCase())
  )

  useInput((ch, inp) => {
    if (step === 'provider') {
      if (inp.upArrow)   { setSelectedIdx(i => Math.max(0, i - 1)); return }
      if (inp.downArrow) { setSelectedIdx(i => Math.min(filtered.length - 1, i + 1)); return }
      if (inp.escape)    { onCancel(); return }
      if (inp.return) {
        const prov = filtered[Math.min(selectedIdx, filtered.length - 1)]
        if (!prov) return
        setSelectedProv(prov)
        setIP('localhost')
        setPort(prov.defaultPort)
        setStep('ip')
        return
      }
    }
    if (step === 'ip') {
      if (inp.escape) { setStep('provider'); return }
      if (inp.return) { setStep('port'); return }
    }
    if (step === 'port') {
      if (inp.escape) { setStep('ip'); return }
      if (inp.return) {
        const provId = selectedProv.id
        const url    = `http://${ip}:${port}${selectedProv.urlSuffix}`
        onConnect(provId, url)
        return
      }
    }
  })

  const breadcrumb =
    step === 'provider' ? '› Choose provider' :
    step === 'ip'       ? `› ${selectedProv.label} › IP address` :
                          `› ${selectedProv.label} › Port`

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#3B82F6" marginX={1}>

      {/* Header */}
      <Box paddingX={2}>
        <Text color="#3B82F6" bold> Connect </Text>
        <Text color="#4B5563">{breadcrumb}</Text>
      </Box>

      {/* Step 1: Provider selection */}
      {step === 'provider' && (
        <>
          <Box paddingX={2} borderStyle="single" borderTop borderColor="#1E3A5F">
            <Text color="#6B7280">/ </Text>
            <TextInput
              value={search}
              onChange={v => { setSearch(v); setSelectedIdx(0) }}
              placeholder="Search provider ..."
              focus
            />
          </Box>

          {filtered.length === 0 ? (
            <Box paddingX={4}><Text color="#6B7280">No provider found</Text></Box>
          ) : (
            filtered.map((p, i) => {
              const sel = i === selectedIdx
              return (
                <Box key={p.id} paddingX={2}>
                  <Text color={sel ? '#3B82F6' : '#374151'}>{sel ? '▶ ' : '  '}</Text>
                  <Text color={sel ? '#93C5FD' : '#9CA3AF'} bold={sel}>{p.label}</Text>
                  <Text color={sel ? '#4B5563' : '#2D3748'}>  :{p.defaultPort}</Text>
                </Box>
              )
            })
          )}
        </>
      )}

      {/* Step 2: IP */}
      {step === 'ip' && (
        <Box paddingX={2} paddingY={1} flexDirection="column">
          <Text color="#6B7280">IP address:</Text>
          <Box marginTop={1} borderStyle="single" borderColor="#1E3A5F" paddingX={1}>
            <TextInput value={ip} onChange={setIP} focus />
          </Box>
        </Box>
      )}

      {/* Step 3: Port */}
      {step === 'port' && (
        <Box paddingX={2} paddingY={1} flexDirection="column">
          <Text color="#6B7280">Port:</Text>
          <Box marginTop={1} borderStyle="single" borderColor="#1E3A5F" paddingX={1}>
            <TextInput value={port} onChange={setPort} focus />
          </Box>
        </Box>
      )}

      {/* Footer */}
      <Box paddingX={2} borderStyle="single" borderTop borderColor="#1E3A5F">
        {step === 'provider' ? (
          <>
            <Text color="#374151">↑↓ </Text><Text color="#4B5563">select  </Text>
            <Text color="#374151">enter </Text><Text color="#4B5563">next  </Text>
            <Text color="#374151">esc </Text><Text color="#4B5563">close</Text>
          </>
        ) : step === 'ip' ? (
          <>
            <Text color="#374151">enter </Text><Text color="#4B5563">next  </Text>
            <Text color="#374151">esc </Text><Text color="#4B5563">back</Text>
          </>
        ) : (
          <>
            <Text color="#22C55E">enter </Text><Text color="#4B5563">connect  </Text>
            <Text color="#374151">esc </Text><Text color="#4B5563">back</Text>
          </>
        )}
      </Box>

    </Box>
  )
}
