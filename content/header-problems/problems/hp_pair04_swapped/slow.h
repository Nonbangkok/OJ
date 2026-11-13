// The naive-but-correct counterpart the harness asks every problem to carry.
//
// Exchanging two components is O(1) whatever you do with it, so this problem
// has no complexity subtask: meta.json sets "has_tle_subtask": false and
// verify.py skips the TLE check for it. The file still has to exist, so it
// holds a genuinely correct implementation that takes the long road — it
// default-constructs the result and then copies the components into place one
// at a time, through an extra pair of local copies. It must therefore produce
// exactly the reference's outputs; it is only wasteful, never wrong.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "pair.h"
using namespace std;

template <typename T1, typename T2>
CP::pair<T2, T1> CP::pair<T1, T2>::swapped() const
{
  T1 keep_first = first;
  T2 keep_second = second;
  CP::pair<T2, T1> result;
  result.first = keep_second;
  result.second = keep_first;
  return result;
}

template <typename T1, typename T2>
void CP::pair<T1, T2>::become(const CP::pair<T2, T1> &other)
{
  CP::pair<T1, T2> flipped = other.swapped();
  first = flipped.first;
  second = flipped.second;
}

#endif
