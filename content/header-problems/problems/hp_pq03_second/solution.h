// Reference solution: the second most important element is a CHILD OF THE
// ROOT, so there are only two candidates.
//
// Every element other than the root has an ancestor chain that ends at the
// root, and every ancestor is at least as important as it is. If an element
// at depth >= 2 were the second most important, its parent (depth >= 1, not
// the root) would be at least as important as it and also not the root, which
// would make it the second one instead. So only indices 1 and 2 can hold it,
// and the answer is the more important of the two — O(1), no scan.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "priority_queue.h"
using namespace std;

template <typename T, typename Comp>
T CP::priority_queue<T, Comp>::second() const
{
  // Your code here
  if (mSize < 2)
    throw std::out_of_range("index out of range");
  if (mSize == 2)
    return mData[1];
  return mLess(mData[1], mData[2]) ? mData[2] : mData[1];
}

#endif
