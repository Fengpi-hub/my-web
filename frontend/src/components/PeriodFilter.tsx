import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PeriodFilterProps {
  years: Array<{ year: number; months: number[] }>
  activeYear: number | null
  activeMonth: number | null
  onChange: (year: number | null, month: number | null) => void
}

// 年月筛选：年份横向标签 + 月份选择器（无照片月份不展示）
export default function PeriodFilter({ years, activeYear, activeMonth, onChange }: PeriodFilterProps) {
  const activeMonths = years.find((item) => item.year === activeYear)?.months ?? []
  const yearIndex = years.findIndex((item) => item.year === activeYear)

  // 年份左右切换
  const stepYear = (delta: number) => {
    const target = years[yearIndex + delta]
    if (!target) return
    onChange(target.year, null)
  }

  return (
    <div className="period-filter">
      <div className="period-years">
        {years.length > 6 && (
          <button
            type="button"
            className="period-year-arrow"
            aria-label="上一年"
            disabled={yearIndex >= 0 && yearIndex >= years.length - 1}
            onClick={() => stepYear(1)}
          >
            <ChevronLeft size={16} />
          </button>
        )}
        <div className="period-year-list">
          {years.map((item) => (
            <button
              key={item.year}
              type="button"
              className={`period-year${item.year === activeYear ? ' is-active' : ''}`}
              onClick={() => onChange(item.year, null)}
            >
              {item.year}
            </button>
          ))}
        </div>
        {years.length > 6 && (
          <button
            type="button"
            className="period-year-arrow"
            aria-label="下一年"
            disabled={yearIndex <= 0}
            onClick={() => stepYear(-1)}
          >
            <ChevronRight size={16} />
          </button>
        )}
      </div>

      {activeYear !== null && activeMonths.length > 0 && (
        <div className="period-months">
          <button
            type="button"
            className={`period-month${activeMonth === null ? ' is-active' : ''}`}
            onClick={() => onChange(activeYear, null)}
          >
            全部
          </button>
          {activeMonths.map((month) => (
            <button
              key={month}
              type="button"
              className={`period-month${activeMonth === month ? ' is-active' : ''}`}
              onClick={() => onChange(activeYear, month)}
            >
              {month}月
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
