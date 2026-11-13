// The naive-but-correct counterpart the harness asks every problem to carry.
//
// A lexicographic comparison of two components is O(1) whatever you do with
// it, so this problem has no complexity subtask: meta.json sets
// "has_tle_subtask": false and verify.py skips the TLE check for it. The file
// still has to exist, so it holds a genuinely correct implementation that
// works the long way round — it evaluates every sub-comparison up front
// instead of returning as soon as the answer is known. It must therefore
// produce exactly the reference's outputs; it is only wasteful, never wrong.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "pair.h"
using namespace std;

template <typename T1, typename T2>
bool CP::pair<T1, T2>::operator<(const CP::pair<T1, T2> &other) const
{
  bool first_smaller = first < other.first;
  bool first_greater = other.first < first;
  bool first_equal = !first_smaller && !first_greater;
  bool second_smaller = second < other.second;
  return first_smaller || (first_equal && second_smaller);
}

template <typename T1, typename T2>
void CP::pair<T1, T2>::make_min(const CP::pair<T1, T2> &other)
{
  if (other < *this)
  {
    first = other.first;
    second = other.second;
  }
}

#endif
