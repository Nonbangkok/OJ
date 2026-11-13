// The naive-but-correct counterpart the harness asks every problem to carry.
//
// One comparison of two components is O(1) whatever you do with it, and the
// grader's sorts are its own work, not the submission's, so this problem has
// no complexity subtask: meta.json sets "has_tle_subtask": false and
// verify.py skips the TLE check for it. The file still has to exist, so it
// holds a genuinely correct implementation written the long way round — it
// evaluates every sub-comparison into a local flag before combining them,
// instead of returning as soon as the answer is known. It must therefore
// produce exactly the reference's outputs, the sorted permutations included;
// it is only wasteful, never wrong.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "pair.h"
using namespace std;

template <typename T1, typename T2>
bool CP::pair<T1, T2>::less_by_second(const CP::pair<T1, T2> &other) const
{
  bool second_less = second < other.second;
  bool second_greater = other.second < second;
  bool second_equal = !second_less && !second_greater;
  bool first_less = first < other.first;
  return second_less || (second_equal && first_less);
}

template <typename T1, typename T2>
bool CP::pair<T1, T2>::greater_by_second(const CP::pair<T1, T2> &other) const
{
  return other.less_by_second(*this);
}

#endif
