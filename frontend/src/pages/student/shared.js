// Shared by the student screens.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useLive } from '../../live';
import { useScope } from '../../layout/scope';

// The school these screens work on: own school, or the one chosen at the top (administration).
export function useStudentSchool() {
  const { user } = useAuth();
  const [scope] = useScope();
  return user.scope === 'all' ? scope : String(user.school?.id || '');
}

// Classes of the school, kept live. Never shows another school's classes while loading.
export function useClasses(school) {
  const [loaded, setLoaded] = useState(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => {
    if (!school) return;
    api.get(`/students/classes?school=${school}`).then((d) => { setLoaded({ school, classes: d.classes }); setError(''); }).catch((e) => setError(e.message));
  }, [school]);
  useEffect(() => { reload(); }, [reload]);
  useLive(['class', 'student', 'studentimport'], reload);
  return { classes: loaded?.school === school ? loaded.classes : null, error, reload };
}

// Text for a class in a drop-down: "P 2 A — PRIMARY TWO A"
export const classOption = (c) => (c.fullName && c.fullName !== c.label ? `${c.label} — ${c.fullName}` : c.label);
