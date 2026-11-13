// The naive-but-correct counterpart the harness asks every problem to carry.
//
// The answer can be as large as mSize - 1, so no solution can beat Omega(n)
// in the worst case and there is no complexity class to separate:
// meta.json sets "has_tle_subtask": false and verify.py skips the TLE check.
// This version is genuinely correct but wasteful — it walks the array twice,
// counting the elements that are no more important than mData[i] and
// subtracting. It must reproduce the reference's outputs exactly.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "priority_queue.h"
using namespace std;

template <typename T, typename Comp>
size_t CP::priority_queue<T, Comp>::rank(size_t i) const
{
  if (i >= mSize)
    throw std::out_of_range("index out of range");

  size_t total = 0;
  for (size_t j = 0; j < mSize; j++)
    total++;

  size_t weaker = 0;
  for (size_t j = 0; j < mSize; j++)
  {
    if (!mLess(mData[i], mData[j]))
      weaker++;
  }
  return total - weaker;
}

#endif
