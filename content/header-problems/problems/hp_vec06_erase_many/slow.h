// Deliberately naive reference: CORRECT, but it deletes the positions one at
// a time, shifting the whole tail on every one of them.
//
// Because the list is ascending, after i deletions the position that was
// positions[i] has slid i places to the left, hence the `- i`. The answer is
// identical to the reference's; the cost is Theta(k * n) instead of
// Theta(n + k), which is why the last subtask deletes 10^5 positions out of a
// million. verify.py requires this file to pass cases 1-5 and to time out on
// case 6.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "vector.h"
using namespace std;

template <typename T>
void CP::vector<T>::erase_many(const std::vector<size_t> &positions)
{
  for (size_t i = 0; i < positions.size(); i++)
  {
    size_t pos = positions[i] - i;
    if (pos >= mSize)
    {
      continue;
    }
    for (size_t j = pos + 1; j < mSize; j++)
    {
      mData[j - 1] = mData[j];
    }
    mSize--;
  }
}

#endif
