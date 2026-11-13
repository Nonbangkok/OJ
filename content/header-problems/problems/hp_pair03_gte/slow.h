// The naive-but-correct counterpart the harness asks every problem to carry.
//
// A lexicographic >= on two components is O(1) whatever you do with it, so
// this problem has no complexity subtask: meta.json sets
// "has_tle_subtask": false and verify.py skips the TLE check for it. The file
// still has to exist, so it holds a genuinely correct implementation written
// the long way round — it builds the answer out of a separate "strictly
// greater" and "equal" test, each of which recomputes the component
// comparisons from scratch. It must therefore produce exactly the reference's
// outputs; it is only wasteful, never wrong.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "pair.h"
using namespace std;

template <typename T1, typename T2>
bool CP::pair<T1, T2>::operator>=(const CP::pair<T1, T2> &other) const
{
  bool first_equal = !(first < other.first) && !(other.first < first);
  bool second_equal = !(second < other.second) && !(other.second < second);
  bool strictly_greater = (other.first < first) || (first_equal && other.second < second);
  bool both_equal = first_equal && second_equal;
  return strictly_greater || both_equal;
}

template <typename T1, typename T2>
void CP::pair<T1, T2>::clamp_low(const CP::pair<T1, T2> &floor)
{
  if (!(*this >= floor))
  {
    first = floor.first;
    second = floor.second;
  }
}

#endif
