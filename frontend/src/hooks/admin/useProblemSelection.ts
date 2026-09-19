import { useState } from 'react';
import type { ChangeEvent } from 'react';

import type { AdminProblem } from '../../types';

import { toggleSelectedProblem } from './problemManagement.helpers';

interface UseProblemSelectionArgs {
  problems: AdminProblem[];
}

/** Selection state for the problems table checkboxes. */
const useProblemSelection = ({ problems }: UseProblemSelectionArgs) => {
  const [selectedProblems, setSelectedProblems] = useState<Array<string | number>>([]);

  const handleToggleSelectProblem = (problemId: string | number) => {
    setSelectedProblems((prev) => toggleSelectedProblem(prev, problemId));
  };

  const handleSelectAll = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) {
      setSelectedProblems(problems.map((problem) => problem.id));
      return;
    }

    setSelectedProblems([]);
  };

  return {
    selectedProblems,
    setSelectedProblems,
    handleToggleSelectProblem,
    handleSelectAll,
  };
};

export default useProblemSelection;
