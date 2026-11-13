// The naive-but-correct counterpart the harness asks every problem to carry.
//
// `operator==` is O(1) whatever you do with it, so this problem has no
// complexity subtask: meta.json sets "has_tle_subtask": false and verify.py
// skips the TLE check for it. The file still has to exist, so it holds a
// genuinely correct implementation that just does more work than it needs to —
// it decides equality by ruling out both strict orderings instead of asking
// the components whether they are equal. It must therefore produce exactly
// the reference's outputs; it is only wasteful, never wrong.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "pair.h"
using namespace std;

template <typename T1, typename T2>
bool CP::pair<T1, T2>::operator==(const CP::pair<T1, T2> &other) const
{
  if (first < other.first)
    return false;
  if (other.first < first)
    return false;
  if (second < other.second)
    return false;
  if (other.second < second)
    return false;
  return true;
}

template <typename T1, typename T2>
void CP::pair<T1, T2>::set(const T1 &a, const T2 &b)
{
  first = a;
  second = b;
}

#endif
