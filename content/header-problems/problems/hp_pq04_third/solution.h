// Reference solution: four candidates, chosen by reasoning rather than by
// scanning.
//
// An element with three or more strictly more important elements above it
// cannot sit at depth <= 2, so the third most important element is at depth 2
// at most — somewhere in indices 1..6. More precisely: let s be the more
// important of the root's two children (that one is the SECOND most important
// element) and o the other one. Anything in o's subtree is no more important
// than o, so it can never beat o; the only things that can beat o are the
// children of s. The answer is therefore the most important of
//
//     o, mData[2s+1], mData[2s+2]
//
// clipped to the indices that exist. That is O(1) whatever mSize is.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "priority_queue.h"
using namespace std;

template <typename T, typename Comp>
T CP::priority_queue<T, Comp>::third() const
{
  // Your code here
  if (mSize < 3)
    throw std::out_of_range("index out of range");

  size_t second = mLess(mData[1], mData[2]) ? 2 : 1;
  size_t best = (second == 1) ? 2 : 1;

  for (size_t child = 2 * second + 1; child <= 2 * second + 2; child++)
  {
    if (child < mSize && mLess(mData[best], mData[child]))
      best = child;
  }
  return mData[best];
}

#endif
