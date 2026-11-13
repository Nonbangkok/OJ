// The naive-but-correct counterpart the harness asks every problem to carry.
//
// Locating the value is Omega(n) however the rest is written, so there is no
// complexity class to separate here: meta.json sets "has_tle_subtask": false
// and verify.py skips the TLE check. This version is genuinely correct but
// wasteful — after filling the hole it rebuilds the whole heap bottom-up
// instead of repairing the one path. It must reproduce the reference's
// outputs exactly, which it does: the grader only ever addresses the heap by
// VALUE, so any correct erase leaves the same multiset behind and prints the
// same lines.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "priority_queue.h"
using namespace std;

template <typename T, typename Comp>
void CP::priority_queue<T, Comp>::erase(const T &value)
{
  size_t found = mSize;
  for (size_t i = 0; i < mSize; i++)
  {
    if (!mLess(mData[i], value) && !mLess(value, mData[i]))
    {
      found = i;
      break;
    }
  }
  if (found == mSize)
    return;

  mSize--;
  if (found == mSize)
    return;
  mData[found] = mData[mSize];

  size_t node = mSize / 2;
  while (node > 0)
  {
    node--;
    fixDown(node);
  }
}

#endif
