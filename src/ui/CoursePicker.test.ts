// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { courseThumbnail, createCourseGrid, createCourseSelector } from './CoursePicker';
import { COURSES, getCourseSpec } from '../course/courses';

describe('course picker', () => {
  it('renders every course as a card and marks the selected one', () => {
    const onSelect = vi.fn();
    const grid = createCourseGrid({ selectedId: 'ember-mesa', bestTimes: { 'ember-mesa': 99.4 }, onSelect });
    const cards = [...grid.querySelectorAll<HTMLButtonElement>('.course-card')];
    expect(cards.map((card) => card.dataset.course)).toEqual(COURSES.map((course) => course.id));
    const selected = cards.filter((card) => card.getAttribute('aria-pressed') === 'true');
    expect(selected.map((card) => card.dataset.course)).toEqual(['ember-mesa']);
    expect(selected[0]!.textContent).toContain('Best 1:39');
    cards[2]!.click();
    expect(onSelect).toHaveBeenCalledWith(COURSES[2]!.id);
  });

  it('cycles through the courses with the menu arrows, wrapping at both ends', () => {
    const onSelect = vi.fn();
    const selector = createCourseSelector({ selectedId: COURSES[0]!.id, bestTimes: {}, onSelect });
    expect(selector.querySelector<HTMLElement>('[data-testid="course-current"]')!.dataset.course).toBe(
      COURSES[0]!.id,
    );
    selector.querySelector<HTMLButtonElement>('[data-testid="course-next"]')!.click();
    expect(onSelect).toHaveBeenLastCalledWith(COURSES[1]!.id);
    selector.querySelector<HTMLButtonElement>('[data-testid="course-prev"]')!.click();
    expect(onSelect).toHaveBeenLastCalledWith(COURSES.at(-1)!.id);
  });

  it('draws a skyline thumbnail, with the sea only where the course has water', () => {
    const coral = courseThumbnail(getCourseSpec('coral-coast')!);
    const ember = courseThumbnail(getCourseSpec('ember-mesa')!);
    expect(coral.startsWith('<svg')).toBe(true);
    expect(coral).toContain('url(#sea-coral-coast)');
    expect(ember).not.toContain('url(#sea-');
    expect(courseThumbnail(getCourseSpec('coral-coast')!)).toBe(coral);
  });
});
