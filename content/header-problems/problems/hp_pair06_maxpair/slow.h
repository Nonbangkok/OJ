// The naive-but-correct counterpart the harness asks every problem to carry.
//
// Picking the larger of two pairs is O(1) whatever you do with it, so this
// problem has no complexity subtask: meta.json sets "has_tle_subtask": false
// and verify.py skips the TLE check for it. The file still has to exist, so it
// holds a genuinely correct implementation that takes the long road — it
// computes a full three-way comparison of both components into local flags
// before choosing, instead of returning as soon as the answer is known. It
// still returns one of the two ORIGINAL objects, so it must produce exactly
// the reference's outputs, 'L'/'R' markers included; it is only wasteful,
// never wrong.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "pair.h"
using namespace std;

template <typename T1, typename T2>
const CP::pair<T1, T2> &CP::pair<T1, T2>::larger(const CP::pair<T1, T2> &other) const
{
  bool first_less = first < other.first;
  bool first_greater = other.first < first;
  bool first_equal = !first_less && !first_greater;
  bool second_less = second < other.second;

  bool other_wins = first_less || (first_equal && second_less);
  if (other_wins)
    return other;
  return *this;
}

template <typename T1, typename T2>
const CP::pair<T1, T2> &CP::pair<T1, T2>::larger3(const CP::pair<T1, T2> &b,
                                                  const CP::pair<T1, T2> &c) const
{
  return larger(b).larger(c);
}

#endif
