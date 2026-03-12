import { useState, useEffect, useCallback } from 'react'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'

interface SystemCheckResult {
  pythonInstalled: boolean
  pythonVersion: string | null
  fasterWhisperInstalled: boolean
  gpuAvailable: boolean
  gpuName: string | null
  anthropicKeySet: boolean
}

type WizardStep = 'checking' | 'results' | 'api-key' | 'done'

interface SetupWizardProps {
  onComplete: () => void
}

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState<WizardStep>('checking')
  const [checks, setChecks] = useState<SystemCheckResult | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)

  const runChecks = useCallback(async () => {
    setStep('checking')
    const result = await window.api.setup.checkSystem()
    if (result.ok) {
      setChecks(result.data)
      setStep('results')
    }
  }, [])

  useEffect(() => {
    runChecks()
  }, [runChecks])

  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) return
    setSaving(true)
    await window.api.setup.saveApiKey(apiKey.trim())
    setSaving(false)
    setStep('done')
  }

  const handleFinish = async () => {
    await window.api.setup.setFirstRunDone()
    onComplete()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-8">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white">Transcripta</h1>
          <p className="mt-2 text-zinc-400">Setup Wizard</p>
        </div>

        {/* Checking step */}
        {step === 'checking' && (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900 p-8">
            <Spinner size="lg" />
            <p className="text-zinc-300">Checking system requirements...</p>
          </div>
        )}

        {/* Results step */}
        {step === 'results' && checks && (
          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
              <h2 className="mb-4 text-lg font-semibold text-white">System Check</h2>

              <div className="space-y-3">
                <CheckRow
                  label="Python"
                  ok={checks.pythonInstalled}
                  detail={checks.pythonVersion ?? 'Not found'}
                  helpUrl="https://www.python.org/downloads/"
                />
                <CheckRow
                  label="faster-whisper"
                  ok={checks.fasterWhisperInstalled}
                  detail={checks.fasterWhisperInstalled ? 'Installed' : 'Not found'}
                  helpText="pip install faster-whisper"
                />
                <CheckRow
                  label="NVIDIA GPU (CUDA)"
                  ok={checks.gpuAvailable}
                  detail={
                    checks.gpuName ??
                    (checks.gpuAvailable ? 'Available' : 'Not detected — will use CPU')
                  }
                  isWarning={!checks.gpuAvailable}
                />
                <CheckRow
                  label="Anthropic API Key"
                  ok={checks.anthropicKeySet}
                  detail={checks.anthropicKeySet ? 'Configured' : 'Not set (needed for summaries)'}
                  isWarning={!checks.anthropicKeySet}
                />
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <Button variant="ghost" onClick={runChecks} className="flex-1">
                Re-check
              </Button>
              {!checks.anthropicKeySet ? (
                <Button onClick={() => setStep('api-key')} className="flex-1">
                  Set API Key
                </Button>
              ) : (
                <Button onClick={handleFinish} className="flex-1">
                  {checks.pythonInstalled && checks.fasterWhisperInstalled
                    ? 'Get Started'
                    : 'Continue Anyway'}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* API key step */}
        {step === 'api-key' && (
          <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
            <h2 className="text-lg font-semibold text-white">Anthropic API Key</h2>
            <p className="text-sm text-zinc-400">
              Required for AI-powered meeting summaries. Get yours at{' '}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 underline"
              >
                console.anthropic.com
              </a>
            </p>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-white placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none"
            />
            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => setStep('results')}>
                Back
              </Button>
              <Button
                onClick={handleSaveApiKey}
                disabled={!apiKey.trim() || saving}
                className="flex-1"
              >
                {saving ? 'Saving...' : 'Save & Continue'}
              </Button>
              <Button variant="ghost" onClick={handleFinish}>
                Skip
              </Button>
            </div>
          </div>
        )}

        {/* Done step */}
        {step === 'done' && (
          <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center">
            <div className="text-4xl">&#10003;</div>
            <h2 className="text-lg font-semibold text-white">All Set!</h2>
            <p className="text-sm text-zinc-400">Transcripta is ready to go.</p>
            <Button onClick={handleFinish} className="w-full">
              Start Using Transcripta
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────

function CheckRow({
  label,
  ok,
  detail,
  helpUrl,
  helpText,
  isWarning,
}: {
  label: string
  ok: boolean
  detail: string
  helpUrl?: string
  helpText?: string
  isWarning?: boolean
}) {
  const icon = ok ? '\u2705' : isWarning ? '\u26A0\uFE0F' : '\u274C'
  const textColor = ok ? 'text-green-400' : isWarning ? 'text-yellow-400' : 'text-red-400'

  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-lg">{icon}</span>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-white">{label}</span>
          <span className={`text-sm ${textColor}`}>{detail}</span>
        </div>
        {!ok && helpUrl && (
          <a
            href={helpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400 underline"
          >
            Download
          </a>
        )}
        {!ok && helpText && <code className="mt-1 block text-xs text-zinc-500">{helpText}</code>}
      </div>
    </div>
  )
}
