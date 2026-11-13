// The naive-but-correct counterpart the harness asks every problem to carry.
//
// A component-wise addition is O(size of the components) however it is
// written, and the grader never lets a sum grow (results are printed, never
// stored), so this problem has no complexity subtask: meta.json sets
// "has_tle_subtask": false and verify.py skips the TLE check for it. The file
// still has to exist, so it holds a genuinely correct implementation that
// takes the long road — it default-constructs the result and then fills each
// component through its own temporary copy. It must therefore produce exactly
// the reference's outputs; it is only wasteful, never wrong.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "pair.h"
using namespace std;

template <typename T1, typename T2>
CP::pair<T1, T2> CP::pair<T1, T2>::operator+(const CP::pair<T1, T2> &other) const
{
  CP::pair<T1, T2> result;
  T1 left_first = first;
  T1 right_first = other.first;
  result.first = left_first + right_first;
  T2 left_second = second;
  T2 right_second = other.second;
  result.second = left_second + right_second;
  return result;
}

template <typename T1, typename T2>
CP::pair<T1, T2> CP::pair<T1, T2>::doubled() const
{
  return *this + *this;
}

#endif
