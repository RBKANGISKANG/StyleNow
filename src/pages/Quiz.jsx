import { useState } from 'react'
import { QUIZ, PERSONAS } from '../data.js'
import { useStore } from '../store.jsx'

export default function Quiz({ go }) {
  const { persona, setPersona } = useStore()
  const [step, setStep] = useState(persona ? QUIZ.length : 0)
  const [scores, setScores] = useState({})

  const answer = weights => {
    const next = { ...scores }
    for (const [k, v] of Object.entries(weights)) next[k] = (next[k] || 0) + v
    if (step + 1 === QUIZ.length) {
      const winner = Object.entries(next).sort((a, b) => b[1] - a[1])[0][0]
      setPersona(winner)
    }
    setScores(next)
    setStep(s => s + 1)
  }

  const retake = () => {
    setPersona(null)
    setScores({})
    setStep(0)
  }

  if (step >= QUIZ.length && persona) {
    const p = PERSONAS[persona]
    return (
      <div className="page quiz-wrap">
        <div className="section-head">
          <h2>Your Style Persona</h2>
        </div>
        <div className="persona-card">
          <div className="persona-emoji">{p.emoji}</div>
          <h2>{p.title}</h2>
          <div className="persona-tagline">{p.tagline}</div>
          <p className="persona-desc">{p.description}</p>
          <div className="persona-tips">
            {p.tips.map(t => (
              <span className="tag accent" key={t}>{t}</span>
            ))}
          </div>
          <div className="persona-actions">
            <button className="btn btn-primary" onClick={() => go('discover')}>
              ✨ See looks picked for you
            </button>
            <button className="btn btn-soft" onClick={retake}>🔄 Retake quiz</button>
          </div>
        </div>
      </div>
    )
  }

  const q = QUIZ[step]
  return (
    <div className="page quiz-wrap">
      <div className="section-head">
        <h2>Style Quiz</h2>
        <span className="sub">Question {step + 1} of {QUIZ.length}</span>
      </div>
      <div className="quiz-progress">
        <div className="quiz-progress-fill" style={{ width: `${(step / QUIZ.length) * 100}%` }} />
      </div>
      <div key={step}>
        <div className="quiz-q">{q.question}</div>
        <div className="quiz-answers">
          {q.answers.map((a, i) => (
            <button className="quiz-answer" key={i} onClick={() => answer(a.weights)}>
              {a.text}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
