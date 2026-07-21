import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { changeAppLanguage, getAppLanguage } from '../i18n'

export function LanguageToggle({ dark = false }: { dark?: boolean }) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage === 'pt-BR' ? 'pt-BR' : getAppLanguage()
  return (
    <div className={dark ? 'language-toggle language-toggle--dark' : 'language-toggle'} role="group" aria-label={t('language.label')}>
      <button type="button" aria-label={t('language.english')} aria-pressed={language === 'en'} onClick={() => changeAppLanguage('en')}>EN</button>
      <button type="button" aria-label={t('language.portuguese')} aria-pressed={language === 'pt-BR'} onClick={() => changeAppLanguage('pt-BR')}>PT-BR</button>
    </div>
  )
}

interface HeaderProps {
  onHome: () => void
  trailing?: ReactNode
}

export function Header({ onHome, trailing }: HeaderProps) {
  const { t } = useTranslation()
  const lyricLines = ['stable', 'memory', 'despair', 'gloom', 'prayer']
    .flatMap((passage) => t(`lyrics.${passage}`).split('\n'))
  const lyricDuration = `${lyricLines.length * 3.2}s`
  return (
    <header className="site-header">
      <div className="header-brand">
        <button className="wordmark" type="button" onClick={onHome} aria-label={t('shell.homeLabel')}>
          <span className="wordmark-mark" aria-hidden="true"><i /></span>
          <span>Solitude</span>
        </button>
        <span className="header-lyric" aria-hidden="true">
          {lyricLines.map((line, index) => (
            <span
              className="header-lyric__line"
              key={`${line}-${index}`}
              style={{ animationDelay: `${index * 3.2}s`, animationDuration: lyricDuration }}
            >{line}</span>
          ))}
        </span>
      </div>
      <div className="header-trailing">{trailing}<LanguageToggle /></div>
    </header>
  )
}

export function Footer() {
  const { t } = useTranslation()
  return (
    <footer className="site-footer">
      <p>{t('shell.footer')}</p>
      <p>
        {t('shell.metadataBy')} <a href="https://musicbrainz.org" target="_blank" rel="noreferrer">MusicBrainz</a>
        {' · '}{t('shell.coverArtBy')} <a href="https://coverartarchive.org" target="_blank" rel="noreferrer">Cover Art Archive</a>
      </p>
    </footer>
  )
}
