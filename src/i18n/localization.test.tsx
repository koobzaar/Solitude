import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'
import i18n, { changeAppLanguage, LANGUAGE_STORAGE_KEY, resources } from '.'

function resourceKeys(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof child === 'object' && child !== null ? resourceKeys(child, path) : [path]
  }).sort()
}

function resourceStrings(value: object): string[] {
  return Object.values(value).flatMap((child) => (
    typeof child === 'object' && child !== null ? resourceStrings(child) : [String(child)]
  ))
}

describe('localized application', () => {
  it('keeps locale resources in parity and updates document metadata with a persisted change', () => {
    expect(resourceKeys(resources.en.translation)).toEqual(resourceKeys(resources['pt-BR'].translation))

    changeAppLanguage('pt-BR')
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('pt-BR')
    expect(document.documentElement).toHaveAttribute('lang', 'pt-BR')
    expect(document.documentElement).toHaveAttribute('dir', 'ltr')
    expect(document.title).toBe('Solitude | Prioridades em vinil')
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute('content', expect.stringMatching(/lista de desejos/i))
    expect(i18n.t('modes.battles', { count: 1_234, formattedCount: new Intl.NumberFormat('pt-BR').format(1_234) })).toBe('1.234 duelos')
    expect(i18n.t('duration.hoursMinutes', { hours: 1, minutes: 5 })).toBe('1 h 5 min')
  })

  it('keeps the meaning-sensitive Portuguese copy direct and accurate', () => {
    const ptBR = resources['pt-BR'].translation

    expect(ptBR.results.heart).toBe('Preferência')
    expect(ptBR.results.heartWeight).toBe('Peso da preferência')
    expect(ptBR.results.heartScore).toBe('Preferência: {{score}}')
    expect([
      ptBR.results.heart,
      ptBR.results.heartWeight,
      ptBR.results.heartNote,
      ptBR.results.heartScore,
      ptBR.results.deeperBody,
    ].join(' ')).not.toMatch(/coração/i)
    expect(ptBR.trackReview.unlike).toBe('Remover curtida de {{title}}')
    expect(ptBR.trackReview.intro).toMatch(/não contam a favor nem contra o álbum/i)
    expect(ptBR.results.recordNote).toMatch(/média da coleção/i)
    expect(ptBR.results.recordNote).toMatch(/oito faixas como referência/i)
    expect(ptBR.results.balanceNote).toMatch(/mesma escala.*proporção escolhida/i)
    expect(ptBR.modes.quick.description).toMatch(/três rodadas.*único cálculo/i)
    expect(ptBR.modes.balanced.description).toMatch(/pares mais incertos.*apareceram menos/i)
    expect(ptBR.modes.thorough.description).toBe('Compara cada par de discos uma vez.')
    expect(ptBR.import.intro).toContain('“Álbum by Artista”')
    expect(resourceStrings(ptBR)).not.toContain('—')
  })

  it('renders persistence notice codes in the active language', () => {
    changeAppLanguage('pt-BR')
    localStorage.setItem('solitude:data:v3', '{broken')
    render(<App />)
    expect(screen.getByRole('status')).toHaveTextContent(/dados salvos estavam ilegíveis/i)
    expect(screen.getByRole('button', { name: /fechar aviso/i })).toBeInTheDocument()
  })

  it('switches immediately without losing the current screen or unsaved form input', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /start a ranking/i }))
    const name = await screen.findByLabelText(/name this collection/i)
    await user.type(name, 'Ainda sem salvar')

    await user.click(screen.getByRole('button', { name: /usar português do brasil/i }))

    expect(screen.getByRole('heading', { name: /crie sua coleção/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/nome da coleção/i)).toHaveValue('Ainda sem salvar')
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('pt-BR')
    expect(screen.getByRole('button', { name: /usar português do brasil/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('covers the Portuguese import, review, mode, tie battle, results, track validation, and dialog flow', async () => {
    changeAppLanguage('pt-BR')
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /criar um ranking/i }))
    await user.type(await screen.findByLabelText(/nome da coleção/i), 'Discos de teste')
    await user.click(screen.getByRole('button', { name: /dia chuvoso/i }))
    await user.click(screen.getByRole('button', { name: /adicionar discos/i }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('solitude:data:v3') ?? '{}').collections[0].vibe).toBe('Rainy day'))

    const list = await screen.findByLabelText(/lista de álbuns/i)
    await user.type(list, ' - Artista\nSegundo - Artista B')
    expect(screen.getByText(/falta o título do álbum/i)).toBeInTheDocument()
    await user.clear(list)
    await user.type(list, 'Primeiro - Artista A\nSegundo - Artista B')
    await user.click(screen.getByRole('button', { name: /revisar 2 álbuns/i }))

    expect(await screen.findByRole('heading', { name: /revise seus álbuns/i })).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: /sem capa para/i })).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: /escolher modo de ranking/i }))
    expect(await screen.findByRole('radiogroup', { name: /modo de ranking/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /começar no modo equilibrado/i }))

    await screen.findByRole('heading', { name: /qual disco vem primeiro/i })
    const matchup = document.querySelector('.battle-page .sr-only')
    expect(matchup).toHaveTextContent(/escolha entre/i)
    expect(matchup).toHaveTextContent(/primeiro/i)
    expect(matchup).toHaveTextContent(/segundo/i)
    await user.click(screen.getByRole('button', { name: /não consigo decidir/i }))
    expect(await screen.findByRole('heading', { name: /você já sabe qual disco vem primeiro/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /revisar as faixas/i }))
    expect(await screen.findByRole('heading', { name: /marque as faixas de que você gosta/i })).toBeInTheDocument()
    await user.type(screen.getByLabelText(/total de faixas/i), '1')
    await user.type(screen.getByLabelText(/faixas curtidas/i), '2')
    expect(screen.getByRole('alert')).toHaveTextContent(/não pode ser maior que o total/i)
    await user.clear(screen.getByLabelText(/faixas curtidas/i))
    await user.type(screen.getByLabelText(/faixas curtidas/i), '1')
    await user.click(screen.getByRole('button', { name: /salvar e ir para o próximo álbum/i }))
    await user.click(screen.getByRole('button', { name: /pular álbum não ouvido/i }))
    expect(await screen.findByRole('tab', { name: /valor do disco/i })).toBeInTheDocument()
    expect(screen.getAllByText(/preferência: 0,00/i)).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: /voltar às coleções/i }))
    await screen.findByRole('heading', { name: /suas coleções/i })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await user.click(screen.getByRole('button', { name: /excluir discos de teste/i }))
    expect(confirm).toHaveBeenCalledWith('Excluir “Discos de teste” e todo o histórico de rankings?')
  }, 15_000)

  it('preserves the active matchup and stored decisions while switching battle language', async () => {
    const timestamp = '2026-07-21T12:00:00.000Z'
    localStorage.setItem('solitude:data:v3', JSON.stringify({
      version: 3,
      learnedPaceSamples: [],
      currentCollectionId: 'collection-1',
      trackProfiles: {},
      collections: [{
        id: 'collection-1', name: 'Battle shelf', createdAt: timestamp, updatedAt: timestamp, completedRuns: [],
        albums: [
          { id: 'a', title: 'Alpha', artist: 'Artist A', sourceText: 'Alpha', matchStatus: 'manual' },
          { id: 'b', title: 'Beta', artist: 'Artist B', sourceText: 'Beta', matchStatus: 'manual' },
        ],
        activeRun: { id: 'run-1', mode: 'balanced', seed: 7, algorithmVersion: 'bt-v1', decisions: [], status: 'active', createdAt: timestamp, updatedAt: timestamp, paceSamples: [] },
      }],
    }))
    sessionStorage.setItem('solitude:navigation:v1', JSON.stringify({ version: 1, screen: 'battle', collectionId: 'collection-1', runId: 'run-1' }))

    const user = userEvent.setup()
    render(<App />)
    const cardsBefore = Array.from(document.querySelectorAll('.choice-card strong')).map((node) => node.textContent)
    await user.click(screen.getByRole('button', { name: /usar português do brasil/i }))

    await waitFor(() => expect(screen.getByRole('heading', { name: /qual disco vem primeiro/i })).toBeInTheDocument())
    expect(Array.from(document.querySelectorAll('.choice-card strong')).map((node) => node.textContent)).toEqual(cardsBefore)
    expect(JSON.parse(localStorage.getItem('solitude:data:v3') ?? '{}').collections[0].activeRun.decisions).toEqual([])
    fireEvent.keyDown(window, { key: '0' })
    expect(await screen.findByRole('heading', { name: /você já sabe qual disco vem primeiro/i })).toBeInTheDocument()
  })
})
