// Reference solution: the class already carries the bounds check as the
// protected helper rangeCheck(index), which throws std::out_of_range exactly
// when index >= mSize. Both overloads are the same two lines; only their
// constness (and so the constness of the returned reference) differs.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "vector.h"
using namespace std;

template <typename T>
T &CP::vector<T>::at(size_t index)
{
  // Your code here
  rangeCheck(index);
  return mData[index];
}

template <typename T>
const T &CP::vector<T>::at(size_t index) const
{
  // Your code here
  rangeCheck(index);
  return mData[index];
}

#endif
